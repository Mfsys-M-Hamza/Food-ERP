import "server-only";
import { db, Prisma } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";
import { authorize, can } from "@/server/core/rbac";
import { todayFor } from "@/server/core/today";
import { computeShiftSummary } from "@/server/modules/shifts/service";

const D = (v: Prisma.Decimal | number | string | null | undefined) => new Prisma.Decimal(v ?? 0);
const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Everything the owner's dashboard shows, in one round of queries. */
export async function dashboardData(ctx: Ctx) {
  authorize(ctx, "dashboard.view");
  const today = await todayFor(ctx.branchId);
  const start = shift(today, -13);
  const lastWeekSameDay = shift(today, -7);
  const b = ctx.branchId;

  const daily = await db.$queryRaw<{ d: string; orders: bigint; total: Prisma.Decimal; refunded: Prisma.Decimal; cost: Prisma.Decimal; disc: Prisma.Decimal; online: bigint }[]>`
    SELECT o.business_date::text AS d, count(*) AS orders, sum(o.grand_total) AS total, sum(o.amount_refunded) AS refunded,
           sum(o.estimated_cost_total) AS cost, sum(o.discount_total) AS disc, count(*) FILTER (WHERE o.source IN ('WEBSITE', 'PWA')) AS online
      FROM orders o
     WHERE o.branch_id = ${b}::uuid AND o.business_date BETWEEN ${start}::date AND ${today}::date AND o.status NOT IN ('NEW', 'CANCELLED')
     GROUP BY 1 ORDER BY 1`;
  const days = Array.from({ length: 14 }, (_, i) => shift(start, i)).map((d) => {
    const r = daily.find((x) => x.d === d);
    return { date: d, orders: Number(r?.orders ?? 0), net: D(r?.total).minus(D(r?.refunded)).toFixed(2) };
  });
  const t = daily.find((x) => x.d === today);
  const lw = daily.find((x) => x.d === lastWeekSameDay);
  const todayNet = D(t?.total).minus(D(t?.refunded));
  const lastWeekNet = D(lw?.total).minus(D(lw?.refunded));

  const top = await db.$queryRaw<{ name: string; qty: bigint; revenue: Prisma.Decimal }[]>`
    SELECT oi.product_name AS name, sum(oi.quantity) AS qty, sum(oi.line_total) AS revenue
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE o.branch_id = ${b}::uuid AND o.business_date BETWEEN ${shift(today, -6)}::date AND ${today}::date AND o.status NOT IN ('NEW', 'CANCELLED')
     GROUP BY 1 ORDER BY qty DESC LIMIT 5`;

  const [live] = await db.$queryRaw<{ waiting: bigint; kitchen: bigint; delivering: bigint }[]>`
    SELECT count(*) FILTER (WHERE o.status = 'NEW') AS waiting,
           count(*) FILTER (WHERE o.status IN ('ACCEPTED', 'PREPARING', 'READY')) AS kitchen,
           count(*) FILTER (WHERE o.status = 'OUT_FOR_DELIVERY') AS delivering
      FROM orders o WHERE o.branch_id = ${b}::uuid AND o.status IN ('NEW', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY')`;
  const [stock] = await db.$queryRaw<{ low: bigint; out: bigint }[]>`
    SELECT count(*) FILTER (WHERE coalesce(st.on_hand, 0) <= i.min_stock AND i.min_stock > 0) AS low,
           count(*) FILTER (WHERE coalesce(st.on_hand, 0) <= 0) AS out
      FROM ingredients i LEFT JOIN ingredient_stock st ON st.ingredient_id = i.id AND st.branch_id = ${b}::uuid
     WHERE i.deleted_at IS NULL AND i.is_active AND i.track_stock`;
  const [money] = await db.$queryRaw<{ expenses: Prisma.Decimal | null; owed: Prisma.Decimal | null; overdue: bigint }[]>`
    SELECT (SELECT sum(amount) FROM expenses WHERE branch_id = ${b}::uuid AND status = 'ACTIVE' AND expense_date = ${today}::date) AS expenses,
           (SELECT sum(total - amount_paid) FROM purchases WHERE branch_id = ${b}::uuid AND status = 'RECEIVED' AND total > amount_paid) AS owed,
           (SELECT count(*) FROM purchases WHERE branch_id = ${b}::uuid AND status = 'RECEIVED' AND total > amount_paid AND due_date < ${today}::date) AS overdue`;

  const openShifts = await db.cashShift.findMany({ where: { branchId: b, status: "OPEN" }, select: { id: true } });
  let drawerCash = D(0);
  for (const s of openShifts) drawerCash = drawerCash.plus((await computeShiftSummary(s.id)).expectedCash);
  const unapproved = await db.cashShift.count({ where: { branchId: b, status: "CLOSED", difference: { not: 0 } } });
  const draftPayroll = can(ctx, "payroll.approve") ? await db.payrollRun.count({ where: { branchId: b, status: { in: ["DRAFT", "APPROVED"] } } }) : 0;
  const [att] = await db.$queryRaw<{ present: bigint; staff: bigint }[]>`
    SELECT (SELECT count(*) FROM attendance WHERE branch_id = ${b}::uuid AND work_date = ${today}::date AND status IN ('PRESENT', 'LATE', 'HALF_DAY')) AS present,
           (SELECT count(*) FROM employees WHERE branch_id = ${b}::uuid AND deleted_at IS NULL AND status = 'ACTIVE') AS staff`;

  const orders = Number(t?.orders ?? 0);
  return {
    today,
    kpi: {
      net: todayNet.toFixed(2),
      changeVsLastWeek: lastWeekNet.isZero() ? null : Number(todayNet.minus(lastWeekNet).div(lastWeekNet).times(100).toFixed(0)),
      orders,
      online: Number(t?.online ?? 0),
      average: orders ? D(t?.total).div(orders).toFixed(2) : "0.00",
      foodCostPct: D(t?.total).isZero() ? null : Number(D(t?.cost).div(D(t?.total)).times(100).toFixed(0)),
      discounts: D(t?.disc).toFixed(2),
      expenses: D(money?.expenses).toFixed(2),
    },
    days,
    top: top.map((x) => ({ name: x.name, qty: Number(x.qty), revenue: x.revenue.toFixed(2) })),
    live: { waiting: Number(live?.waiting ?? 0), kitchen: Number(live?.kitchen ?? 0), delivering: Number(live?.delivering ?? 0) },
    attention: {
      lowStock: Number(stock?.low ?? 0),
      outOfStock: Number(stock?.out ?? 0),
      owedToSuppliers: D(money?.owed).toFixed(2),
      overdueInvoices: Number(money?.overdue ?? 0),
      openShifts: openShifts.length,
      drawerCash: drawerCash.toFixed(2),
      shiftsToReview: unapproved,
      payrollPending: draftPayroll,
      staffPresent: Number(att?.present ?? 0),
      staffTotal: Number(att?.staff ?? 0),
    },
  };
}
