import "server-only";
import { z } from "zod";
import { db, Prisma } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";
import { authorize } from "@/server/core/rbac";
import { validationFailed } from "@/server/core/errors";
import { todayFor } from "@/server/core/today";
import { REPORTS, SNAPSHOT_REPORTS, type ReportKey, type ReportResult, type ReportRow, type ReportTile } from "@/lib/reports";
import { formatQty } from "@/lib/units";

/**
 * Reports. Every figure is computed in SQL from the operational tables, so
 * reports always match the orders, expenses and stock screens.
 *
 * A "sale" is an order that was accepted and not cancelled (status other than
 * NEW or CANCELLED), dated by its business day. Refunds are shown separately.
 */

const D = (v: Prisma.Decimal | number | string | null | undefined) => new Prisma.Decimal(v ?? 0);
const m2 = (v: Prisma.Decimal | number | string | null | undefined) => D(v).toFixed(2);
const int = (v: bigint | number | null | undefined) => Number(v ?? 0);
const pct = (part: Prisma.Decimal, whole: Prisma.Decimal) => (whole.isZero() ? 0 : Number(part.div(whole).times(100).toFixed(1)));

export const rangeSchema = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() });

type Range = { from: string; to: string; tz: string; branchId: string };

async function resolveRange(ctx: Ctx, input: unknown): Promise<Range> {
  const r = rangeSchema.safeParse(input);
  if (!r.success) throw validationFailed({ from: ["Use valid dates"] });
  const today = await todayFor(ctx.branchId);
  const from = r.data.from ?? `${today.slice(0, 8)}01`;
  const to = r.data.to ?? today;
  if (to < from) throw validationFailed({ to: ["The end date is before the start date"] });
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 366) throw validationFailed({ to: ["Choose a period of at most one year"] });
  const branch = await db.branch.findUniqueOrThrow({ where: { id: ctx.branchId }, select: { timezone: true } });
  return { from, to, tz: branch.timezone, branchId: ctx.branchId };
}

/** Orders that count as sales in the period. Use with alias `o`. */
const sold = (r: Range) =>
  Prisma.sql`o.branch_id = ${r.branchId}::uuid AND o.business_date BETWEEN ${r.from}::date AND ${r.to}::date AND o.status NOT IN ('NEW', 'CANCELLED')`;
/** A timestamp column falls on a local calendar date in the period. */
const onLocalDay = (col: Prisma.Sql, r: Range) => Prisma.sql`(${col} AT TIME ZONE ${r.tz})::date BETWEEN ${r.from}::date AND ${r.to}::date`;

const money = (label: string, value: Prisma.Decimal | string | number, hint?: string): ReportTile => ({ label, value: m2(value), type: "money", hint });
const count = (label: string, value: number, hint?: string): ReportTile => ({ label, value, type: "number", hint });

// ═══ Sales ═══════════════════════════════════════════════════════════════════

async function sales(r: Range): Promise<Partial<ReportResult>> {
  const rows = await db.$queryRaw<
    { d: string; orders: bigint; gross: Prisma.Decimal; disc: Prisma.Decimal; tax: Prisma.Decimal; delivery: Prisma.Decimal; service: Prisma.Decimal; total: Prisma.Decimal; refunded: Prisma.Decimal }[]
  >`SELECT o.business_date::text AS d, count(*) AS orders, sum(o.subtotal) AS gross, sum(o.discount_total) AS disc, sum(o.tax_total) AS tax,
           sum(o.delivery_charge) AS delivery, sum(o.service_charge) AS service, sum(o.grand_total) AS total, sum(o.amount_refunded) AS refunded
      FROM orders o WHERE ${sold(r)} GROUP BY 1 ORDER BY 1`;
  const sum = (k: "gross" | "disc" | "tax" | "delivery" | "service" | "total" | "refunded") => rows.reduce((a, x) => a.plus(x[k]), D(0));
  const orders = rows.reduce((a, x) => a + int(x.orders), 0);
  const net = sum("total").minus(sum("refunded"));
  const toRow = (x: { d: string; orders: number; gross: Prisma.Decimal; disc: Prisma.Decimal; tax: Prisma.Decimal; delivery: Prisma.Decimal; total: Prisma.Decimal; refunded: Prisma.Decimal }): ReportRow => ({
    date: x.d,
    orders: x.orders,
    gross: m2(x.gross),
    discounts: m2(x.disc),
    tax: m2(x.tax),
    delivery: m2(x.delivery),
    total: m2(x.total),
    refunds: m2(x.refunded),
    net: m2(x.total.minus(x.refunded)),
    average: x.orders ? m2(x.total.div(x.orders)) : "0.00",
  });
  return {
    tiles: [money("Net sales", net, "After refunds"), count("Orders", orders), money("Average order", orders ? sum("total").div(orders) : 0), money("Discounts given", sum("disc"))],
    chart: { label: "date", value: "net", type: "money" },
    columns: [
      { key: "date", label: "Day", type: "date" },
      { key: "orders", label: "Orders", type: "number" },
      { key: "gross", label: "Items", type: "money", hideOnMobile: true },
      { key: "discounts", label: "Discounts", type: "money", hideOnMobile: true },
      { key: "tax", label: "Tax", type: "money", hideOnMobile: true },
      { key: "delivery", label: "Delivery", type: "money", hideOnMobile: true },
      { key: "total", label: "Total", type: "money", hideOnMobile: true },
      { key: "refunds", label: "Refunds", type: "money", hideOnMobile: true },
      { key: "net", label: "Net sales", type: "money" },
      { key: "average", label: "Avg order", type: "money", hideOnMobile: true },
    ],
    rows: rows.map((x) => toRow({ ...x, orders: int(x.orders) })),
    totals: { ...toRow({ d: "Total", orders, gross: sum("gross"), disc: sum("disc"), tax: sum("tax"), delivery: sum("delivery"), total: sum("total"), refunded: sum("refunded") }), date: "Total" },
  };
}

async function itemSales(r: Range, by: "product" | "category"): Promise<Partial<ReportResult>> {
  const rows =
    by === "product"
      ? await db.$queryRaw<{ name: string; variant: string | null; category: string | null; qty: bigint; revenue: Prisma.Decimal; cost: Prisma.Decimal }[]>`
          SELECT oi.product_name AS name, oi.variant_name AS variant, c.name AS category, sum(oi.quantity) AS qty, sum(oi.line_total) AS revenue,
                 sum(oi.unit_cost_estimate * oi.quantity) AS cost
            FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN categories c ON c.id = oi.category_id
           WHERE ${sold(r)} GROUP BY 1, 2, 3 ORDER BY revenue DESC`
      : await db.$queryRaw<{ name: string; variant: null; category: null; qty: bigint; revenue: Prisma.Decimal; cost: Prisma.Decimal }[]>`
          SELECT coalesce(c.name, 'Uncategorised') AS name, NULL AS variant, NULL AS category, sum(oi.quantity) AS qty, sum(oi.line_total) AS revenue,
                 sum(oi.unit_cost_estimate * oi.quantity) AS cost
            FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN categories c ON c.id = oi.category_id
           WHERE ${sold(r)} GROUP BY 1 ORDER BY revenue DESC`;
  const revenue = rows.reduce((a, x) => a.plus(x.revenue), D(0));
  const cost = rows.reduce((a, x) => a.plus(x.cost), D(0));
  const qty = rows.reduce((a, x) => a + int(x.qty), 0);
  return {
    tiles: [money("Item revenue", revenue), count(by === "product" ? "Items sold" : "Items sold", qty), money("Estimated food cost", cost), { label: "Food cost %", value: pct(cost, revenue), type: "percent" }],
    chart: { label: "name", value: "revenue", type: "money" },
    columns: [
      { key: "name", label: by === "product" ? "Item" : "Category", type: "text" },
      ...(by === "product" ? [{ key: "category", label: "Category", type: "text" as const, hideOnMobile: true }] : []),
      { key: "qty", label: "Sold", type: "number" },
      { key: "revenue", label: "Revenue", type: "money" },
      { key: "cost", label: "Est. cost", type: "money", hideOnMobile: true },
      { key: "margin", label: "Margin %", type: "percent", hideOnMobile: true },
      { key: "share", label: "Share %", type: "percent", hideOnMobile: true },
    ],
    rows: rows.map((x) => ({
      name: x.variant ? `${x.name} (${x.variant})` : x.name,
      category: x.category ?? "",
      qty: int(x.qty),
      revenue: m2(x.revenue),
      cost: m2(x.cost),
      margin: pct(x.revenue.minus(x.cost), x.revenue),
      share: pct(x.revenue, revenue),
    })),
    totals: { name: "Total", category: "", qty, revenue: m2(revenue), cost: m2(cost), margin: pct(revenue.minus(cost), revenue), share: 100 },
    notes: ["Revenue is the item price before order-level discounts. Cost comes from recipes at the time of sale; items without a recipe show no cost."],
  };
}

async function hourly(r: Range): Promise<Partial<ReportResult>> {
  const rows = await db.$queryRaw<{ h: number; orders: bigint; total: Prisma.Decimal }[]>`
    SELECT extract(hour FROM o.created_at AT TIME ZONE ${r.tz})::int AS h, count(*) AS orders, sum(o.grand_total) AS total
      FROM orders o WHERE ${sold(r)} GROUP BY 1 ORDER BY 1`;
  const days = (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 + 1;
  const total = rows.reduce((a, x) => a.plus(x.total), D(0));
  const busiest = [...rows].sort((a, b) => int(b.orders) - int(a.orders))[0];
  const label = (h: number) => `${String(h).padStart(2, "0")}:00–${String((h + 1) % 24).padStart(2, "0")}:00`;
  return {
    tiles: [money("Sales", total), count("Orders", rows.reduce((a, x) => a + int(x.orders), 0)), { label: "Busiest hour", value: busiest ? label(busiest.h) : "—", type: "text" }],
    chart: { label: "hour", value: "orders", type: "number" },
    columns: [
      { key: "hour", label: "Hour", type: "text" },
      { key: "orders", label: "Orders", type: "number" },
      { key: "perDay", label: "Orders per day", type: "number", hideOnMobile: true },
      { key: "total", label: "Sales", type: "money" },
      { key: "average", label: "Avg order", type: "money", hideOnMobile: true },
    ],
    rows: rows.map((x) => ({
      hour: label(x.h),
      orders: int(x.orders),
      perDay: Number((int(x.orders) / days).toFixed(1)),
      total: m2(x.total),
      average: int(x.orders) ? m2(x.total.div(int(x.orders))) : "0.00",
    })),
  };
}

async function payments(r: Range): Promise<Partial<ReportResult>> {
  const paid = await db.$queryRaw<{ method: string; n: bigint; amount: Prisma.Decimal }[]>`
    SELECT p.method::text AS method, count(*) AS n, sum(p.amount) AS amount FROM payments p JOIN orders o ON o.id = p.order_id
     WHERE ${sold(r)} AND p.status = 'SUCCEEDED' GROUP BY 1`;
  const refunded = await db.$queryRaw<{ method: string; n: bigint; amount: Prisma.Decimal }[]>`
    SELECT r.method::text AS method, count(*) AS n, sum(r.amount) AS amount FROM refunds r JOIN orders o ON o.id = r.order_id
     WHERE ${sold(r)} GROUP BY 1`;
  const LABEL: Record<string, string> = { CASH: "Cash", CARD: "Card", ONLINE: "Online transfer", WALLET: "Wallet", LOYALTY: "Loyalty points" };
  const methods = [...new Set([...paid.map((p) => p.method), ...refunded.map((p) => p.method)])];
  const rows = methods.map((mth) => {
    const p = paid.find((x) => x.method === mth);
    const f = refunded.find((x) => x.method === mth);
    return { method: LABEL[mth] ?? mth, payments: int(p?.n), amount: D(p?.amount), refunds: D(f?.amount), net: D(p?.amount).minus(D(f?.amount)) };
  });
  rows.sort((a, b) => b.net.comparedTo(a.net));
  const t = (k: "amount" | "refunds" | "net") => rows.reduce((a, x) => a.plus(x[k]), D(0));
  return {
    tiles: rows.slice(0, 4).map((x) => money(x.method, x.net)),
    chart: { label: "method", value: "net", type: "money" },
    columns: [
      { key: "method", label: "Method", type: "text" },
      { key: "payments", label: "Payments", type: "number" },
      { key: "amount", label: "Received", type: "money" },
      { key: "refunds", label: "Refunded", type: "money" },
      { key: "net", label: "Net", type: "money" },
      { key: "share", label: "Share %", type: "percent", hideOnMobile: true },
    ],
    rows: rows.map((x) => ({ method: x.method, payments: x.payments, amount: m2(x.amount), refunds: m2(x.refunds), net: m2(x.net), share: pct(x.net, t("net")) })),
    totals: { method: "Total", payments: rows.reduce((a, x) => a + x.payments, 0), amount: m2(t("amount")), refunds: m2(t("refunds")), net: m2(t("net")), share: 100 },
    notes: ["Unpaid cash-on-delivery orders appear once the rider's cash is settled."],
  };
}

async function sources(r: Range): Promise<Partial<ReportResult>> {
  const rows = await db.$queryRaw<{ source: string; type: string; orders: bigint; total: Prisma.Decimal }[]>`
    SELECT o.source::text AS source, o.type::text AS type, count(*) AS orders, sum(o.grand_total) AS total
      FROM orders o WHERE ${sold(r)} GROUP BY 1, 2 ORDER BY total DESC`;
  const SRC: Record<string, string> = { POS: "Counter (POS)", PHONE: "Phone", WEBSITE: "Website", PWA: "App", ADMIN: "Admin", AGGREGATOR: "Food app" };
  const TYPE: Record<string, string> = { TAKEAWAY: "Takeaway", DELIVERY: "Delivery", DINE_IN: "Dine-in" };
  const total = rows.reduce((a, x) => a.plus(x.total), D(0));
  const bySource = new Map<string, Prisma.Decimal>();
  for (const x of rows) bySource.set(SRC[x.source] ?? x.source, (bySource.get(SRC[x.source] ?? x.source) ?? D(0)).plus(x.total));
  return {
    tiles: [...bySource.entries()].slice(0, 4).map(([k, v]) => money(k, v)),
    chart: { label: "channel", value: "total", type: "money" },
    columns: [
      { key: "channel", label: "Channel", type: "text" },
      { key: "orders", label: "Orders", type: "number" },
      { key: "total", label: "Sales", type: "money" },
      { key: "average", label: "Avg order", type: "money", hideOnMobile: true },
      { key: "share", label: "Share %", type: "percent", hideOnMobile: true },
    ],
    rows: rows.map((x) => ({
      channel: `${SRC[x.source] ?? x.source} · ${TYPE[x.type] ?? x.type}`,
      orders: int(x.orders),
      total: m2(x.total),
      average: m2(x.total.div(int(x.orders) || 1)),
      share: pct(x.total, total),
    })),
    totals: { channel: "Total", orders: rows.reduce((a, x) => a + int(x.orders), 0), total: m2(total), average: "", share: 100 },
  };
}

async function discounts(r: Range): Promise<Partial<ReportResult>> {
  const rows = await db.$queryRaw<
    { d: string; num: string; kind: string; percent: Prisma.Decimal | null; amount: Prisma.Decimal; reason: string | null; applied: string | null; approved: string | null }[]
  >`SELECT o.business_date::text AS d, o.order_number AS num, d.kind::text AS kind, d.percent, d.amount, d.reason, ua.name AS applied, ub.name AS approved
      FROM order_discounts d JOIN orders o ON o.id = d.order_id
      LEFT JOIN users ua ON ua.id = d.applied_by LEFT JOIN users ub ON ub.id = d.approved_by
     WHERE ${sold(r)} ORDER BY o.created_at DESC LIMIT 5000`;
  const KIND: Record<string, string> = { MANUAL: "Staff discount", COUPON: "Coupon", LOYALTY: "Loyalty", PROMOTION: "Promotion" };
  const total = rows.reduce((a, x) => a.plus(x.amount), D(0));
  const byKind = new Map<string, Prisma.Decimal>();
  for (const x of rows) byKind.set(KIND[x.kind] ?? x.kind, (byKind.get(KIND[x.kind] ?? x.kind) ?? D(0)).plus(x.amount));
  return {
    tiles: [money("Total discounts", total), count("Discounted orders", rows.length), ...[...byKind.entries()].map(([k, v]) => money(k, v))],
    columns: [
      { key: "date", label: "Day", type: "date" },
      { key: "order", label: "Order", type: "text" },
      { key: "kind", label: "Type", type: "text", hideOnMobile: true },
      { key: "reason", label: "Reason", type: "text", hideOnMobile: true },
      { key: "appliedBy", label: "Given by", type: "text", hideOnMobile: true },
      { key: "approvedBy", label: "Approved by", type: "text", hideOnMobile: true },
      { key: "amount", label: "Amount", type: "money" },
    ],
    rows: rows.map((x) => ({
      date: x.d,
      order: x.num,
      kind: `${KIND[x.kind] ?? x.kind}${x.percent ? ` ${Number(x.percent)}%` : ""}`,
      reason: x.reason ?? "",
      appliedBy: x.applied ?? "",
      approvedBy: x.approved ?? "",
      amount: m2(x.amount),
    })),
    totals: { date: "Total", order: "", kind: "", reason: "", appliedBy: "", approvedBy: "", amount: m2(total) },
  };
}

async function refunds(r: Range): Promise<Partial<ReportResult>> {
  const rows = await db.$queryRaw<
    { at: Date; num: string; ord: string; method: string; amount: Prisma.Decimal; reason: string; req: string | null; appr: string | null }[]
  >`SELECT r.created_at AS at, r.refund_number AS num, o.order_number AS ord, r.method::text AS method, r.amount, r.reason, uq.name AS req, ua.name AS appr
      FROM refunds r JOIN orders o ON o.id = r.order_id
      LEFT JOIN users uq ON uq.id = r.requested_by LEFT JOIN users ua ON ua.id = r.approved_by
     WHERE r.branch_id = ${r.branchId}::uuid AND ${onLocalDay(Prisma.sql`r.created_at`, r)} ORDER BY r.created_at DESC`;
  const total = rows.reduce((a, x) => a.plus(x.amount), D(0));
  return {
    tiles: [money("Total refunded", total), count("Refunds", rows.length)],
    columns: [
      { key: "date", label: "Date", type: "date" },
      { key: "refund", label: "Refund", type: "text" },
      { key: "order", label: "Order", type: "text" },
      { key: "method", label: "Method", type: "text", hideOnMobile: true },
      { key: "reason", label: "Reason", type: "text", hideOnMobile: true },
      { key: "approvedBy", label: "Approved by", type: "text", hideOnMobile: true },
      { key: "amount", label: "Amount", type: "money" },
    ],
    rows: rows.map((x) => ({
      date: x.at.toISOString(),
      refund: x.num,
      order: x.ord,
      method: x.method.toLowerCase(),
      reason: x.reason,
      approvedBy: x.appr ?? x.req ?? "",
      amount: m2(x.amount),
    })),
    totals: { date: "Total", refund: "", order: "", method: "", reason: "", approvedBy: "", amount: m2(total) },
  };
}

async function cashiers(r: Range): Promise<Partial<ReportResult>> {
  const sales = await db.$queryRaw<{ id: string; name: string; orders: bigint; total: Prisma.Decimal; disc: Prisma.Decimal }[]>`
    SELECT u.id, u.name, count(*) AS orders, sum(o.grand_total) AS total, sum(o.discount_total) AS disc
      FROM orders o JOIN users u ON u.id = o.created_by
     WHERE ${sold(r)} AND o.source IN ('POS', 'PHONE', 'ADMIN') GROUP BY u.id, u.name`;
  const shifts = await db.$queryRaw<{ id: string; name: string; n: bigint; diff: Prisma.Decimal | null; short: bigint }[]>`
    SELECT u.id, u.name, count(*) AS n, sum(s.difference) AS diff, count(*) FILTER (WHERE s.difference < 0) AS short
      FROM cash_shifts s JOIN users u ON u.id = s.opened_by
     WHERE s.branch_id = ${r.branchId}::uuid AND s.status <> 'OPEN' AND ${onLocalDay(Prisma.sql`s.opened_at`, r)} GROUP BY u.id, u.name`;
  const ids = [...new Set([...sales.map((s) => s.id), ...shifts.map((s) => s.id)])];
  const rows = ids.map((id) => {
    const s = sales.find((x) => x.id === id);
    const sh = shifts.find((x) => x.id === id);
    return {
      name: s?.name ?? sh?.name ?? "",
      orders: int(s?.orders),
      total: m2(s?.total),
      average: s && int(s.orders) ? m2(s.total.div(int(s.orders))) : "0.00",
      discounts: m2(s?.disc),
      shifts: int(sh?.n),
      shortShifts: int(sh?.short),
      difference: m2(sh?.diff),
    };
  });
  rows.sort((a, b) => Number(b.total) - Number(a.total));
  return {
    tiles: [count("Staff who sold", sales.length), money("Counter sales", sales.reduce((a, x) => a.plus(x.total), D(0))), money("Cash difference", shifts.reduce((a, x) => a.plus(D(x.diff)), D(0)), "Closed shifts; negative = short")],
    chart: { label: "name", value: "total", type: "money" },
    columns: [
      { key: "name", label: "Staff", type: "text" },
      { key: "orders", label: "Orders", type: "number" },
      { key: "total", label: "Sales", type: "money" },
      { key: "average", label: "Avg order", type: "money", hideOnMobile: true },
      { key: "discounts", label: "Discounts", type: "money", hideOnMobile: true },
      { key: "shifts", label: "Shifts", type: "number", hideOnMobile: true },
      { key: "shortShifts", label: "Short shifts", type: "number", hideOnMobile: true },
      { key: "difference", label: "Cash +/-", type: "money" },
    ],
    rows,
  };
}

async function customers(r: Range): Promise<Partial<ReportResult>> {
  const rows = await db.$queryRaw<{ name: string; phone: string | null; orders: bigint; total: Prisma.Decimal; last: Date }[]>`
    SELECT c.name, c.phone, count(*) AS orders, sum(o.grand_total) AS total, max(o.created_at) AS last
      FROM orders o JOIN customers c ON c.id = o.customer_id
     WHERE ${sold(r)} GROUP BY c.id, c.name, c.phone ORDER BY total DESC LIMIT 200`;
  const [stats] = await db.$queryRaw<{ customers: bigint; repeat: bigint; first_time: bigint; guest_orders: bigint }[]>`
    WITH period AS (
      SELECT o.customer_id, count(*) AS n FROM orders o WHERE ${sold(r)} AND o.customer_id IS NOT NULL GROUP BY 1
    ), firsts AS (
      SELECT o.customer_id, min(o.business_date) AS first FROM orders o
       WHERE o.branch_id = ${r.branchId}::uuid AND o.status NOT IN ('NEW', 'CANCELLED') AND o.customer_id IS NOT NULL GROUP BY 1
    )
    SELECT (SELECT count(*) FROM period) AS customers,
           (SELECT count(*) FROM period WHERE n > 1) AS repeat,
           (SELECT count(*) FROM firsts WHERE first BETWEEN ${r.from}::date AND ${r.to}::date) AS first_time,
           (SELECT count(*) FROM orders o WHERE ${sold(r)} AND o.customer_id IS NULL) AS guest_orders`;
  return {
    tiles: [
      count("Customers who ordered", int(stats?.customers)),
      count("New customers", int(stats?.first_time), "First order in this period"),
      count("Ordered more than once", int(stats?.repeat)),
      count("Walk-in orders", int(stats?.guest_orders), "No customer attached"),
    ],
    columns: [
      { key: "name", label: "Customer", type: "text" },
      { key: "phone", label: "Phone", type: "text", hideOnMobile: true },
      { key: "orders", label: "Orders", type: "number" },
      { key: "total", label: "Spent", type: "money" },
      { key: "average", label: "Avg order", type: "money", hideOnMobile: true },
      { key: "last", label: "Last order", type: "date", hideOnMobile: true },
    ],
    rows: rows.map((x) => ({ name: x.name, phone: x.phone ?? "", orders: int(x.orders), total: m2(x.total), average: m2(x.total.div(int(x.orders) || 1)), last: x.last.toISOString() })),
  };
}

// ═══ Money ═══════════════════════════════════════════════════════════════════

async function expenseTotals(r: Range) {
  return db.$queryRaw<{ name: string; system: string | null; n: bigint; amount: Prisma.Decimal }[]>`
    SELECT c.name, c.system_key AS system, count(*) AS n, sum(e.amount) AS amount
      FROM expenses e JOIN expense_categories c ON c.id = e.category_id
     WHERE e.branch_id = ${r.branchId}::uuid AND e.status = 'ACTIVE' AND e.expense_date BETWEEN ${r.from}::date AND ${r.to}::date
     GROUP BY c.name, c.system_key ORDER BY amount DESC`;
}

async function expenses(r: Range): Promise<Partial<ReportResult>> {
  const rows = await expenseTotals(r);
  const byMethod = await db.$queryRaw<{ method: string; amount: Prisma.Decimal }[]>`
    SELECT e.payment_method::text AS method, sum(e.amount) AS amount FROM expenses e
     WHERE e.branch_id = ${r.branchId}::uuid AND e.status = 'ACTIVE' AND e.expense_date BETWEEN ${r.from}::date AND ${r.to}::date GROUP BY 1`;
  const total = rows.reduce((a, x) => a.plus(x.amount), D(0));
  const cash = byMethod.filter((x) => x.method === "CASH_DRAWER").reduce((a, x) => a.plus(x.amount), D(0));
  return {
    tiles: [money("Total expenses", total), count("Expense entries", rows.reduce((a, x) => a + int(x.n), 0)), money("Paid from tills", cash)],
    chart: { label: "category", value: "amount", type: "money" },
    columns: [
      { key: "category", label: "Category", type: "text" },
      { key: "entries", label: "Entries", type: "number" },
      { key: "amount", label: "Amount", type: "money" },
      { key: "share", label: "Share %", type: "percent" },
    ],
    rows: rows.map((x) => ({ category: x.name, entries: int(x.n), amount: m2(x.amount), share: pct(x.amount, total) })),
    totals: { category: "Total", entries: rows.reduce((a, x) => a + int(x.n), 0), amount: m2(total), share: 100 },
  };
}

async function purchases(r: Range): Promise<Partial<ReportResult>> {
  const rows = await db.$queryRaw<{ name: string; n: bigint; total: Prisma.Decimal; paid: Prisma.Decimal }[]>`
    SELECT s.name, count(*) AS n, sum(p.total) AS total, sum(p.amount_paid) AS paid
      FROM purchases p JOIN suppliers s ON s.id = p.supplier_id
     WHERE p.branch_id = ${r.branchId}::uuid AND p.status = 'RECEIVED' AND p.invoice_date BETWEEN ${r.from}::date AND ${r.to}::date
     GROUP BY s.name ORDER BY total DESC`;
  const [owed] = await db.$queryRaw<{ due: Prisma.Decimal | null; overdue: Prisma.Decimal | null }[]>`
    SELECT sum(p.total - p.amount_paid) AS due,
           sum(p.total - p.amount_paid) FILTER (WHERE p.due_date < (now() AT TIME ZONE ${r.tz})::date) AS overdue
      FROM purchases p WHERE p.branch_id = ${r.branchId}::uuid AND p.status = 'RECEIVED' AND p.total > p.amount_paid`;
  const total = rows.reduce((a, x) => a.plus(x.total), D(0));
  const paid = rows.reduce((a, x) => a.plus(x.paid), D(0));
  return {
    tiles: [money("Purchased", total), money("Paid (these invoices)", paid), money("Owed to suppliers now", D(owed?.due)), money("Overdue now", D(owed?.overdue))],
    chart: { label: "supplier", value: "total", type: "money" },
    columns: [
      { key: "supplier", label: "Supplier", type: "text" },
      { key: "invoices", label: "Invoices", type: "number" },
      { key: "total", label: "Total", type: "money" },
      { key: "paid", label: "Paid", type: "money" },
      { key: "outstanding", label: "Outstanding", type: "money" },
    ],
    rows: rows.map((x) => ({ supplier: x.name, invoices: int(x.n), total: m2(x.total), paid: m2(x.paid), outstanding: m2(x.total.minus(x.paid)) })),
    totals: { supplier: "Total", invoices: rows.reduce((a, x) => a + int(x.n), 0), total: m2(total), paid: m2(paid), outstanding: m2(total.minus(paid)) },
    notes: ["Purchases are stock, not expenses: their cost reaches the profit report as food cost when ingredients are used or wasted."],
  };
}

async function payroll(r: Range): Promise<Partial<ReportResult>> {
  const rows = await db.$queryRaw<
    { run: string; status: string; ps: string; pe: string; name: string; designation: string; gross: Prisma.Decimal; ded: Prisma.Decimal; net: Prisma.Decimal; paid_at: Date | null }[]
  >`SELECT pr.run_number AS run, pr.status::text AS status, pr.period_start::text AS ps, pr.period_end::text AS pe, p.employee_name AS name, p.designation,
           p.gross, p.deductions AS ded, p.net, p.paid_at
      FROM payslips p JOIN payroll_runs pr ON pr.id = p.payroll_run_id
     WHERE pr.branch_id = ${r.branchId}::uuid AND pr.status <> 'CANCELLED' AND pr.period_start <= ${r.to}::date AND pr.period_end >= ${r.from}::date
     ORDER BY pr.period_start, p.employee_name`;
  const t = (k: "gross" | "ded" | "net") => rows.reduce((a, x) => a.plus(x[k]), D(0));
  const paid = rows.filter((x) => x.paid_at).reduce((a, x) => a.plus(x.net), D(0));
  return {
    tiles: [money("Gross pay", t("gross")), money("Deductions", t("ded")), money("Net pay", t("net")), money("Still to pay", t("net").minus(paid))],
    columns: [
      { key: "run", label: "Payroll", type: "text" },
      { key: "employee", label: "Employee", type: "text" },
      { key: "designation", label: "Job", type: "text", hideOnMobile: true },
      { key: "gross", label: "Gross", type: "money", hideOnMobile: true },
      { key: "deductions", label: "Deductions", type: "money", hideOnMobile: true },
      { key: "net", label: "Net", type: "money" },
      { key: "status", label: "Status", type: "text" },
    ],
    rows: rows.map((x) => ({
      run: `${x.run} (${x.ps} to ${x.pe})`,
      employee: x.name,
      designation: x.designation,
      gross: m2(x.gross),
      deductions: m2(x.ded),
      net: m2(x.net),
      status: x.paid_at ? "Paid" : x.status === "APPROVED" ? "Approved" : "Draft",
    })),
    totals: { run: "Total", employee: "", designation: "", gross: m2(t("gross")), deductions: m2(t("ded")), net: m2(t("net")), status: "" },
  };
}

async function profit(r: Range): Promise<Partial<ReportResult>> {
  const [s] = await db.$queryRaw<{ orders: bigint; sales: Prisma.Decimal | null; tax: Prisma.Decimal | null; refunded: Prisma.Decimal | null; cogs: Prisma.Decimal | null; uncosted: bigint }[]>`
    SELECT count(*) AS orders, sum(o.grand_total) AS sales, sum(o.tax_total) AS tax, sum(o.amount_refunded) AS refunded, sum(o.estimated_cost_total) AS cogs,
           (SELECT count(*) FROM order_items oi JOIN orders o2 ON o2.id = oi.order_id
             WHERE o2.branch_id = ${r.branchId}::uuid AND o2.business_date BETWEEN ${r.from}::date AND ${r.to}::date
               AND o2.status NOT IN ('NEW', 'CANCELLED') AND oi.unit_cost_estimate = 0) AS uncosted
      FROM orders o WHERE ${sold(r)}`;
  const [w] = await db.$queryRaw<{ cost: Prisma.Decimal | null }[]>`
    SELECT sum(w.estimated_cost) AS cost FROM wastage w WHERE w.branch_id = ${r.branchId}::uuid AND ${onLocalDay(Prisma.sql`w.occurred_at`, r)}`;
  const exp = await expenseTotals(r);

  const salesTotal = D(s?.sales);
  const tax = D(s?.tax);
  const refundsAmt = D(s?.refunded);
  const revenue = salesTotal.minus(tax).minus(refundsAmt);
  const cogs = D(s?.cogs);
  const wastage = D(w?.cost);
  const gross = revenue.minus(cogs);
  const expTotal = exp.reduce((a, x) => a.plus(x.amount), D(0));
  const staff = exp.filter((x) => x.system).reduce((a, x) => a.plus(x.amount), D(0));
  const net = gross.minus(wastage).minus(expTotal);

  const line = (item: string, amount: Prisma.Decimal, kind: "add" | "less" | "total" = "less"): ReportRow => ({
    item,
    amount: m2(kind === "less" ? amount.negated() : amount),
    share: pct(amount, revenue),
    kind,
  });
  const rows: ReportRow[] = [
    line("Sales collected (incl. tax and delivery)", salesTotal, "add"),
    line("Tax collected (owed to the government)", tax),
    line("Refunds", refundsAmt),
    line("Net revenue", revenue, "total"),
    line("Food cost of items sold (estimated)", cogs),
    line("Gross profit", gross, "total"),
    line("Wastage", wastage),
    ...exp.map((x) => line(`${x.name}`, x.amount)),
    line("Estimated net profit", net, "total"),
  ];
  const notes = [
    "This is an estimate for running the business, not an accounting statement. Confirm figures with your accountant.",
    "Food cost uses recipe costs at the time of each sale (weighted average purchase prices). Supplier purchases are not listed separately, so stock is not counted twice.",
    "Salaries and salary advances are counted when paid (cash basis).",
  ];
  if (int(s?.uncosted) > 0) notes.push(`${int(s?.uncosted)} sold item lines had no recipe cost, so food cost may be understated.`);
  return {
    tiles: [
      money("Net revenue", revenue),
      { label: "Gross margin", value: pct(gross, revenue), type: "percent", hint: `Food cost ${pct(cogs, revenue)}%` },
      money("Expenses", expTotal, staff.greaterThan(0) ? `Staff ${m2(staff)}` : undefined),
      money("Estimated net profit", net, `${pct(net, revenue)}% of revenue`),
    ],
    columns: [
      { key: "item", label: "", type: "text" },
      { key: "amount", label: "Amount", type: "money" },
      { key: "share", label: "% of revenue", type: "percent" },
    ],
    rows,
    notes,
  };
}

// ═══ Stock ═══════════════════════════════════════════════════════════════════

async function stock(r: Range, lowOnly: boolean): Promise<Partial<ReportResult>> {
  const rows = await db.$queryRaw<{ name: string; category: string | null; unit: "g" | "ml" | "piece"; onhand: Prisma.Decimal; cost: Prisma.Decimal; min: Prisma.Decimal; reorder: Prisma.Decimal; supplier: string | null }[]>`
    SELECT i.name, i.category, i.base_unit::text AS unit, coalesce(st.on_hand, 0) AS onhand, i.average_cost AS cost, i.min_stock AS min, i.reorder_qty AS reorder, s.name AS supplier
      FROM ingredients i
      LEFT JOIN ingredient_stock st ON st.ingredient_id = i.id AND st.branch_id = ${r.branchId}::uuid
      LEFT JOIN suppliers s ON s.id = i.default_supplier_id
     WHERE i.deleted_at IS NULL AND i.is_active AND i.track_stock
     ORDER BY i.category NULLS LAST, i.name`;
  const list = lowOnly ? rows.filter((x) => x.min.greaterThan(0) && x.onhand.lessThanOrEqualTo(x.min)) : rows;
  const value = (x: (typeof rows)[number]) => (x.onhand.greaterThan(0) ? x.onhand.times(x.cost) : D(0));
  const total = list.reduce((a, x) => a.plus(value(x)), D(0));
  const low = rows.filter((x) => x.min.greaterThan(0) && x.onhand.lessThanOrEqualTo(x.min)).length;
  return {
    tiles: lowOnly
      ? [count("Items to reorder", list.length), count("Out of stock", list.filter((x) => x.onhand.lessThanOrEqualTo(0)).length)]
      : [money("Stock value", total, "At average cost"), count("Ingredients", rows.length), count("Low or out", low), count("Negative balances", rows.filter((x) => x.onhand.isNegative()).length, "Count these")],
    columns: lowOnly
      ? [
          { key: "name", label: "Ingredient", type: "text" },
          { key: "onHand", label: "On hand", type: "text" },
          { key: "min", label: "Minimum", type: "text" },
          { key: "reorder", label: "Usual order", type: "text", hideOnMobile: true },
          { key: "supplier", label: "Supplier", type: "text", hideOnMobile: true },
        ]
      : [
          { key: "name", label: "Ingredient", type: "text" },
          { key: "category", label: "Group", type: "text", hideOnMobile: true },
          { key: "onHand", label: "On hand", type: "text" },
          { key: "avgCost", label: "Avg cost / unit", type: "text", hideOnMobile: true },
          { key: "value", label: "Value", type: "money" },
          { key: "status", label: "Status", type: "text", hideOnMobile: true },
        ],
    rows: list.map((x) => ({
      name: x.name,
      category: x.category ?? "",
      onHand: formatQty(x.onhand.toString(), x.unit),
      min: formatQty(x.min.toString(), x.unit),
      reorder: x.reorder.greaterThan(0) ? formatQty(x.reorder.toString(), x.unit) : "",
      supplier: x.supplier ?? "",
      avgCost: `Rs ${x.cost.times(x.unit === "piece" ? 1 : 1000).toFixed(2)} / ${x.unit === "g" ? "kg" : x.unit === "ml" ? "l" : "pc"}`,
      value: m2(value(x)),
      status: x.onhand.lessThanOrEqualTo(0) ? "Out" : x.min.greaterThan(0) && x.onhand.lessThanOrEqualTo(x.min) ? "Low" : "OK",
    })),
    ...(lowOnly ? {} : { totals: { name: "Total", category: "", onHand: "", avgCost: "", value: m2(total), status: "" } }),
  };
}

async function wastageReport(r: Range): Promise<Partial<ReportResult>> {
  const rows = await db.$queryRaw<{ item: string; reason: string; n: bigint; cost: Prisma.Decimal }[]>`
    SELECT w.item_name AS item, w.reason::text AS reason, count(*) AS n, sum(w.estimated_cost) AS cost
      FROM wastage w WHERE w.branch_id = ${r.branchId}::uuid AND ${onLocalDay(Prisma.sql`w.occurred_at`, r)}
     GROUP BY 1, 2 ORDER BY cost DESC`;
  const LABEL: Record<string, string> = { EXPIRED: "Expired", BURNED: "Burned", DAMAGED: "Damaged", SPOILED: "Spoiled", WRONG_PREPARATION: "Wrong preparation", STAFF_MEAL: "Staff meal", CANCELLED_ORDER: "Cancelled order", OTHER: "Other" };
  const total = rows.reduce((a, x) => a.plus(x.cost), D(0));
  const byReason = new Map<string, Prisma.Decimal>();
  for (const x of rows) byReason.set(LABEL[x.reason] ?? x.reason, (byReason.get(LABEL[x.reason] ?? x.reason) ?? D(0)).plus(x.cost));
  return {
    tiles: [money("Wastage cost", total), ...[...byReason.entries()].sort((a, b) => b[1].comparedTo(a[1])).slice(0, 3).map(([k, v]) => money(k, v))],
    chart: { label: "item", value: "cost", type: "money" },
    columns: [
      { key: "item", label: "Item", type: "text" },
      { key: "reason", label: "Reason", type: "text" },
      { key: "entries", label: "Times", type: "number" },
      { key: "cost", label: "Est. cost", type: "money" },
    ],
    rows: rows.map((x) => ({ item: x.item, reason: LABEL[x.reason] ?? x.reason, entries: int(x.n), cost: m2(x.cost) })),
    totals: { item: "Total", reason: "", entries: rows.reduce((a, x) => a + int(x.n), 0), cost: m2(total) },
  };
}

async function consumption(r: Range): Promise<Partial<ReportResult>> {
  const rows = await db.$queryRaw<{ name: string; unit: "g" | "ml" | "piece"; used: Prisma.Decimal; cost: Prisma.Decimal }[]>`
    SELECT i.name, i.base_unit::text AS unit, -sum(t.quantity) AS used, -sum(t.total_cost) AS cost
      FROM inventory_transactions t JOIN ingredients i ON i.id = t.ingredient_id
     WHERE t.branch_id = ${r.branchId}::uuid AND t.type IN ('SALE', 'SALE_REVERSAL') AND ${onLocalDay(Prisma.sql`t.created_at`, r)}
     GROUP BY i.id, i.name, i.base_unit ORDER BY cost DESC`;
  const days = (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 + 1;
  const total = rows.reduce((a, x) => a.plus(x.cost), D(0));
  return {
    tiles: [money("Ingredients used (cost)", total), count("Ingredients", rows.length)],
    chart: { label: "ingredient", value: "cost", type: "money" },
    columns: [
      { key: "ingredient", label: "Ingredient", type: "text" },
      { key: "used", label: "Used", type: "text" },
      { key: "perDay", label: "Per day", type: "text", hideOnMobile: true },
      { key: "cost", label: "Cost", type: "money" },
      { key: "share", label: "Share %", type: "percent", hideOnMobile: true },
    ],
    rows: rows.map((x) => ({ ingredient: x.name, used: formatQty(x.used.toString(), x.unit), perDay: formatQty(x.used.div(days).toFixed(3), x.unit), cost: m2(x.cost), share: pct(x.cost, total) })),
    totals: { ingredient: "Total", used: "", perDay: "", cost: m2(total), share: 100 },
    notes: ["Usage recorded when orders reach the deduction stage; wastage is reported separately."],
  };
}

// ═══ People ══════════════════════════════════════════════════════════════════

async function attendance(r: Range): Promise<Partial<ReportResult>> {
  const rows = await db.$queryRaw<
    { name: string; code: string; present: bigint; late: bigint; half: bigint; absent: bigint; leave: bigint; late_min: bigint; worked: bigint; ot: bigint }[]
  >`SELECT e.full_name AS name, e.employee_code AS code,
           count(*) FILTER (WHERE a.status IN ('PRESENT', 'LATE')) AS present,
           count(*) FILTER (WHERE a.status = 'LATE') AS late,
           count(*) FILTER (WHERE a.status = 'HALF_DAY') AS half,
           count(*) FILTER (WHERE a.status = 'ABSENT') AS absent,
           count(*) FILTER (WHERE a.status IN ('PAID_LEAVE', 'UNPAID_LEAVE')) AS leave,
           sum(a.late_minutes) AS late_min, sum(a.worked_minutes) AS worked, sum(a.overtime_minutes) AS ot
      FROM attendance a JOIN employees e ON e.id = a.employee_id
     WHERE a.branch_id = ${r.branchId}::uuid AND a.work_date BETWEEN ${r.from}::date AND ${r.to}::date
     GROUP BY e.id, e.full_name, e.employee_code ORDER BY e.full_name`;
  const sumOf = (k: "present" | "late" | "absent") => rows.reduce((a, x) => a + int(x[k]), 0);
  return {
    tiles: [count("Days present", sumOf("present")), count("Late arrivals", sumOf("late")), count("Absences", sumOf("absent")), { label: "Overtime", value: rows.reduce((a, x) => a + int(x.ot), 0), type: "minutes" }],
    columns: [
      { key: "name", label: "Employee", type: "text" },
      { key: "present", label: "Present", type: "number" },
      { key: "late", label: "Late", type: "number" },
      { key: "half", label: "Half days", type: "number", hideOnMobile: true },
      { key: "absent", label: "Absent", type: "number" },
      { key: "leave", label: "Leave", type: "number", hideOnMobile: true },
      { key: "lateMinutes", label: "Late time", type: "minutes", hideOnMobile: true },
      { key: "worked", label: "Worked", type: "minutes", hideOnMobile: true },
      { key: "overtime", label: "Overtime", type: "minutes", hideOnMobile: true },
    ],
    rows: rows.map((x) => ({
      name: `${x.name} (${x.code})`,
      present: int(x.present),
      late: int(x.late),
      half: int(x.half),
      absent: int(x.absent),
      leave: int(x.leave),
      lateMinutes: int(x.late_min),
      worked: int(x.worked),
      overtime: int(x.ot),
    })),
  };
}

// ═══ Entry point ═════════════════════════════════════════════════════════════

export async function runReport(ctx: Ctx, key: ReportKey, input: unknown): Promise<ReportResult> {
  const def = REPORTS[key];
  authorize(ctx, def.permission);
  const r = await resolveRange(ctx, input);
  const body = await (async (): Promise<Partial<ReportResult>> => {
    switch (key) {
      case "sales":
        return sales(r);
      case "products":
        return itemSales(r, "product");
      case "categories":
        return itemSales(r, "category");
      case "hourly":
        return hourly(r);
      case "payments":
        return payments(r);
      case "sources":
        return sources(r);
      case "discounts":
        return discounts(r);
      case "refunds":
        return refunds(r);
      case "cashiers":
        return cashiers(r);
      case "customers":
        return customers(r);
      case "profit":
        return profit(r);
      case "expenses":
        return expenses(r);
      case "purchases":
        return purchases(r);
      case "payroll":
        return payroll(r);
      case "inventory":
        return stock(r, false);
      case "low-stock":
        return stock(r, true);
      case "wastage":
        return wastageReport(r);
      case "consumption":
        return consumption(r);
      case "attendance":
        return attendance(r);
    }
  })();
  const snapshot = SNAPSHOT_REPORTS.includes(key);
  return {
    key,
    title: def.title,
    from: snapshot ? null : r.from,
    to: snapshot ? null : r.to,
    tiles: body.tiles ?? [],
    chart: body.chart,
    columns: body.columns ?? [],
    rows: body.rows ?? [],
    totals: body.totals,
    notes: body.notes,
  };
}
