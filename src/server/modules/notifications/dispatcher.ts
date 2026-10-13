import "server-only";
import { db, Prisma } from "@/server/core/db";
import { logger } from "@/server/core/logger";
import { env } from "@/server/core/env";
import type { DomainEvent } from "@/server/core/events";
import { getSetting } from "@/server/modules/settings/service";
import { expirePoints } from "@/server/modules/marketing/loyalty";
import { notify } from "./service";
import { sendMessage } from "./channels";

/**
 * Turns domain events from the outbox into notifications and customer
 * messages. Events are claimed atomically (FOR UPDATE SKIP LOCKED and marked
 * processed in the same statement), so concurrent runs never double-send;
 * failures are released for a retry (up to 5 attempts).
 */
export async function dispatchOutbox(limit = 50) {
  const claimed = await db.$queryRaw<{ id: bigint; type: string; payload: DomainEvent }[]>`
    UPDATE outbox_events SET processed_at = now(), attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM outbox_events WHERE processed_at IS NULL AND attempts < 5 ORDER BY id LIMIT ${limit} FOR UPDATE SKIP LOCKED
     )
    RETURNING id, type, payload`;
  let done = 0;
  for (const e of claimed.sort((a, b) => Number(a.id - b.id))) {
    try {
      await handle(e.payload);
      done++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ eventId: e.id.toString(), type: e.type, err: message }, "Event dispatch failed");
      await db.outboxEvent.update({ where: { id: e.id }, data: { processedAt: null, lastError: message.slice(0, 500) } });
    }
  }
  return { claimed: claimed.length, done };
}

const D = (v: Prisma.Decimal | null | undefined) => new Prisma.Decimal(v ?? 0);

async function handle(e: DomainEvent) {
  switch (e.type) {
    case "order.created": {
      if (e.source !== "WEBSITE" && e.source !== "PWA") return;
      const o = await db.order.findUnique({ where: { id: e.orderId }, select: { displayNumber: true, grandTotal: true, type: true, status: true } });
      if (!o || o.status !== "NEW") return;
      await notify({
        permission: "orders.accept",
        type: "order.online",
        severity: "WARNING",
        title: `New online order #${o.displayNumber}`,
        body: `${o.type === "DELIVERY" ? "Delivery" : "Pickup"} · Rs ${o.grandTotal.toFixed(0)}`,
        link: "/pos",
        dedupeKey: `order.created:${e.orderId}`,
        branchId: e.branchId,
      });
      return;
    }
    case "order.status_changed":
      await messageCustomer(e.orderId, e.to);
      return;
    case "order.refunded": {
      if (!e.large) return;
      const o = await db.order.findUnique({ where: { id: e.orderId }, select: { orderNumber: true } });
      await notify({ permission: "orders.refund", type: "order.refund", severity: "WARNING", title: `Large refund Rs ${D(new Prisma.Decimal(e.amount)).toFixed(0)}`, body: `Order ${o?.orderNumber ?? ""}`, link: "/admin/orders", dedupeKey: `order.refunded:${e.orderId}:${e.amount}`, branchId: e.branchId });
      return;
    }
    case "shift.closed": {
      if (!e.outOfTolerance) return;
      const s = await db.cashShift.findUnique({ where: { id: e.shiftId }, select: { shiftNumber: true, openedBy: { select: { name: true } } } });
      const diff = new Prisma.Decimal(e.difference);
      await notify({
        permission: "shifts.approve",
        type: "shift.difference",
        severity: "WARNING",
        title: `Shift ${s?.shiftNumber ?? ""} closed Rs ${diff.abs().toFixed(0)} ${diff.isNegative() ? "short" : "over"}`,
        body: s ? `Cashier: ${s.openedBy.name}` : undefined,
        link: `/admin/cash-shifts/${e.shiftId}`,
        dedupeKey: `shift.closed:${e.shiftId}`,
        branchId: e.branchId,
      });
      return;
    }
    case "stock.low": {
      const i = await db.ingredient.findUnique({ where: { id: e.ingredientId }, select: { name: true } });
      if (!i) return;
      const day = new Date().toISOString().slice(0, 10);
      await notify({ permission: "inventory.manage", type: "stock.low", title: `${i.name} is running low`, link: `/admin/inventory/${e.ingredientId}`, dedupeKey: `stock.low:${e.ingredientId}:${day}`, branchId: e.branchId });
      return;
    }
    case "purchase.payment_due": {
      const p = await db.purchase.findUnique({ where: { id: e.purchaseId }, select: { purchaseNumber: true, total: true, amountPaid: true, supplier: { select: { name: true } } } });
      if (!p) return;
      await notify({ permission: "purchases.pay", type: "purchase.due", title: `Payment due to ${p.supplier.name}`, body: `${p.purchaseNumber} · Rs ${p.total.minus(p.amountPaid).toFixed(0)}`, link: `/admin/purchases/${e.purchaseId}`, dedupeKey: `purchase.due:${e.purchaseId}`, branchId: e.branchId });
      return;
    }
    default:
      return;
  }
}

/** Optional SMS / WhatsApp updates to the customer at key moments. */
async function messageCustomer(orderId: string, status: string) {
  const s = await getSetting("notifications");
  if (s.customerOrderMessages === "NONE") return;
  const o = await db.order.findUnique({ where: { id: orderId }, select: { customerPhone: true, displayNumber: true, type: true, trackingToken: true, source: true } });
  if (!o?.customerPhone) return;
  const profile = await getSetting("business.profile");
  const text =
    status === "ACCEPTED" && (o.source === "WEBSITE" || o.source === "PWA")
      ? `your order #${o.displayNumber} has been accepted.`
      : status === "READY" && o.type === "TAKEAWAY"
        ? `your order #${o.displayNumber} is ready for pickup.`
        : status === "OUT_FOR_DELIVERY"
          ? `your order #${o.displayNumber} is on the way.`
          : null;
  if (!text) return;
  const url = `${env().BETTER_AUTH_URL.replace(/\/$/, "")}/order/${o.trackingToken}`;
  await sendMessage({ channel: s.customerOrderMessages, to: o.customerPhone, body: `${profile.name}: ${text} Track: ${url}`, relatedType: "order", relatedId: orderId });
}

// ═══ Scheduled checks ════════════════════════════════════════════════════════

/** Online orders nobody has accepted in time raise an urgent alert (once per order). */
export async function alertUnacceptedOrders(now = new Date()) {
  const ordering = await getSetting("ordering");
  const minutes = ordering.unacceptedAlertMinutes;
  if (!minutes || minutes <= 0) return 0;
  const late = await db.order.findMany({
    where: { status: "NEW", source: { in: ["WEBSITE", "PWA"] }, createdAt: { lte: new Date(now.getTime() - minutes * 60_000) } },
    select: { id: true, displayNumber: true, createdAt: true, branchId: true, grandTotal: true },
    take: 20,
  });
  for (const o of late) {
    const waited = Math.floor((now.getTime() - o.createdAt.getTime()) / 60_000);
    await notify({
      permission: "orders.accept",
      type: "order.unaccepted",
      severity: "CRITICAL",
      title: `Online order #${o.displayNumber} waiting ${waited} min`,
      body: `Rs ${o.grandTotal.toFixed(0)} · not accepted yet. Accept or reject it on the POS.`,
      link: "/pos",
      dedupeKey: `order.unaccepted:${o.id}`,
      branchId: o.branchId,
    });
  }
  return late.length;
}

/** Supplier invoices past their due date (once per invoice). */
export async function alertOverdueInvoices(today: string) {
  const rows = await db.purchase.findMany({
    where: { status: "RECEIVED", dueDate: { lt: new Date(`${today}T00:00:00Z`) }, paymentStatus: { not: "PAID" } },
    select: { id: true, purchaseNumber: true, total: true, amountPaid: true, branchId: true, supplier: { select: { name: true } } },
    take: 50,
  });
  for (const p of rows) {
    await notify({ permission: "purchases.pay", type: "purchase.overdue", severity: "WARNING", title: `Overdue: ${p.supplier.name}`, body: `${p.purchaseNumber} · Rs ${p.total.minus(p.amountPaid).toFixed(0)} unpaid`, link: `/admin/purchases/${p.id}`, dedupeKey: `purchase.overdue:${p.id}`, branchId: p.branchId });
  }
  return rows.length;
}

let lastRun = 0;

/** Everything periodic. Called by the cron route and, at most every 5 s, by staff screens polling for alerts. */
export async function runJobs(opts: { force?: boolean } = {}) {
  const now = Date.now();
  if (!opts.force && now - lastRun < 5_000) return null;
  lastRun = now;
  const today = new Date(now + 5 * 3_600_000).toISOString().slice(0, 10);
  const dispatched = await dispatchOutbox();
  const unaccepted = await alertUnacceptedOrders();
  const overdue = await alertOverdueInvoices(today);
  const loyalty = await expirePoints();
  const otp = await db.otpCode.deleteMany({ where: { createdAt: { lt: new Date(now - 86_400_000) } } });
  return { dispatched, unaccepted, overdue, expiredPoints: loyalty.expired, otpPurged: otp.count };
}
