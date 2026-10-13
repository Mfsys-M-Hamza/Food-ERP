import "server-only";
import { z } from "zod";
import { db, withTransaction, Prisma, type Db } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";
import { authorize } from "@/server/core/rbac";
import { recordAudit } from "@/server/core/audit";
import { invalidState, notFound, validationFailed } from "@/server/core/errors";
import { getSetting } from "@/server/modules/settings/service";

/**
 * Loyalty points. The ledger (loyalty_transactions) is append-only and
 * customers.loyalty_points is its running balance. Points are spent and
 * expired oldest first, tracked with the `consumed` counter on EARN rows.
 *
 * Earned when an order is completed (items after discounts; delivery and tax
 * excluded). Redeemed as a discount. Cancelling returns redeemed points and
 * takes back earned ones; refunds take back points in proportion.
 */

const D = (v: string | number | Prisma.Decimal | null | undefined) => new Prisma.Decimal(v ?? 0);

type LoyaltySettings = Awaited<ReturnType<typeof getSetting<"loyalty">>>;

async function post(
  tx: Db,
  e: { customerId: string; orderId?: string | null; type: "EARN" | "REDEEM" | "REVERSE_EARN" | "REVERSE_REDEEM" | "EXPIRE" | "ADJUST"; points: number; expiresAt?: Date | null; note?: string; userId?: string | null },
) {
  if (e.points === 0) return null;
  // Lock the customer row so concurrent orders cannot overspend.
  const [row] = await tx.$queryRaw<{ loyalty_points: number }[]>`SELECT loyalty_points FROM customers WHERE id = ${e.customerId}::uuid FOR UPDATE`;
  if (!row) throw notFound("Customer");
  const balance = row.loyalty_points + e.points;
  if (balance < 0) throw validationFailed({ redeemPoints: [`Only ${row.loyalty_points} points available`] }, `Only ${row.loyalty_points} points available.`);
  await tx.customer.update({ where: { id: e.customerId }, data: { loyaltyPoints: balance } });
  if (e.points < 0 && e.type !== "REVERSE_EARN") await consumeOldest(tx, e.customerId, -e.points);
  if (e.type === "REVERSE_EARN") await consumeEarn(tx, e.customerId, e.orderId ?? null, -e.points);
  return tx.loyaltyTransaction.create({
    data: { customerId: e.customerId, orderId: e.orderId ?? null, type: e.type, points: e.points, balanceAfter: balance, expiresAt: e.expiresAt ?? null, note: e.note ?? null, createdById: e.userId || null },
  });
}

/** Mark points as used on the oldest unexpired EARN rows (FIFO). */
async function consumeOldest(tx: Db, customerId: string, points: number) {
  let left = points;
  const rows = await tx.loyaltyTransaction.findMany({ where: { customerId, type: { in: ["EARN", "REVERSE_REDEEM", "ADJUST"] }, points: { gt: 0 } }, orderBy: { id: "asc" } });
  for (const r of rows) {
    if (left <= 0) break;
    const free = r.points - r.consumed;
    if (free <= 0) continue;
    const take = Math.min(free, left);
    await tx.loyaltyTransaction.update({ where: { id: r.id }, data: { consumed: r.consumed + take } });
    left -= take;
  }
}

/** Taking back points earned on a specific order consumes that order's EARN row first. */
async function consumeEarn(tx: Db, customerId: string, orderId: string | null, points: number) {
  let left = points;
  if (orderId) {
    const earn = await tx.loyaltyTransaction.findFirst({ where: { customerId, orderId, type: "EARN" } });
    if (earn) {
      const take = Math.min(earn.points - earn.consumed, left);
      if (take > 0) {
        await tx.loyaltyTransaction.update({ where: { id: earn.id }, data: { consumed: earn.consumed + take } });
        left -= take;
      }
    }
  }
  if (left > 0) await consumeOldest(tx, customerId, left);
}

/** Rupee value of points, and how many points may be used on an order. */
export function redemptionFor(s: LoyaltySettings, requested: number, balance: number, eligible: Prisma.Decimal): { points: number; amount: Prisma.Decimal } {
  if (!s.enabled || requested <= 0) return { points: 0, amount: D(0) };
  if (requested > balance) throw validationFailed({ redeemPoints: [`Only ${balance} points available`] }, `Only ${balance} points available.`);
  if (requested < s.minimumRedeemPoints) throw validationFailed({ redeemPoints: [`At least ${s.minimumRedeemPoints} points are needed to redeem`] }, `At least ${s.minimumRedeemPoints} points are needed to redeem.`);
  const value = D(s.pointValue);
  if (value.lessThanOrEqualTo(0)) return { points: 0, amount: D(0) };
  const cap = eligible.times(s.maxRedeemPercent).div(100);
  const maxPoints = cap.div(value).floor().toNumber();
  const points = Math.min(requested, maxPoints);
  return { points, amount: value.times(points).toDecimalPlaces(2) };
}

export async function redeemForOrder(tx: Db, customerId: string, orderId: string, points: number, userId: string | null) {
  await post(tx, { customerId, orderId, type: "REDEEM", points: -points, note: "Used on order", userId });
}

/** Points for a completed order. */
export async function earnForOrder(tx: Db, orderId: string) {
  const s = await getSetting("loyalty", tx);
  if (!s.enabled) return;
  const o = await tx.order.findUnique({ where: { id: orderId } });
  if (!o?.customerId) return;
  if (await tx.loyaltyTransaction.findFirst({ where: { orderId, type: "EARN" } })) return;
  const per = D(s.spendPerPoint);
  if (per.lessThanOrEqualTo(0)) return;
  const eligible = o.subtotal.minus(o.discountTotal).minus(o.amountRefunded);
  const points = eligible.div(per).floor().toNumber();
  if (points <= 0) return;
  const expiresAt = s.expiryDays > 0 ? new Date(Date.now() + s.expiryDays * 86_400_000) : null;
  await post(tx, { customerId: o.customerId, orderId, type: "EARN", points, expiresAt, note: `Order ${o.orderNumber}` });
}

/** Cancelled order: return redeemed points and take back earned ones. */
export async function reverseForOrder(tx: Db, orderId: string, reason: string) {
  const rows = await tx.loyaltyTransaction.findMany({ where: { orderId } });
  if (!rows.length) return;
  const customerId = rows[0]!.customerId;
  const redeemed = -rows.filter((r) => r.type === "REDEEM").reduce((a, r) => a + r.points, 0) - rows.filter((r) => r.type === "REVERSE_REDEEM").reduce((a, r) => a + r.points, 0);
  if (redeemed > 0) await post(tx, { customerId, orderId, type: "REVERSE_REDEEM", points: redeemed, note: reason });
  await takeBackEarned(tx, customerId, orderId, null, reason);
}

/** Refund: take back earned points in proportion to the amount refunded (all of them on a full refund). */
export async function reverseForRefund(tx: Db, orderId: string, refundAmount: Prisma.Decimal) {
  const o = await tx.order.findUnique({ where: { id: orderId } });
  if (!o?.customerId) return;
  const earned = await tx.loyaltyTransaction.findFirst({ where: { orderId, type: "EARN" } });
  if (!earned) return;
  const share = o.amountPaid.isZero() ? D(1) : Prisma.Decimal.min(1, refundAmount.div(o.amountPaid));
  await takeBackEarned(tx, o.customerId, orderId, share.times(earned.points).ceil().toNumber(), "Refund");
}

async function takeBackEarned(tx: Db, customerId: string, orderId: string, wanted: number | null, note: string) {
  const rows = await tx.loyaltyTransaction.findMany({ where: { orderId, type: { in: ["EARN", "REVERSE_EARN"] } } });
  const outstanding = rows.reduce((a, r) => a + r.points, 0);
  if (outstanding <= 0) return;
  const c = await tx.customer.findUniqueOrThrow({ where: { id: customerId }, select: { loyaltyPoints: true } });
  // Points already spent cannot be clawed back below zero.
  const take = Math.min(wanted ?? outstanding, outstanding, c.loyaltyPoints);
  if (take > 0) await post(tx, { customerId, orderId, type: "REVERSE_EARN", points: -take, note });
}

/** Expire lapsed points (run by the scheduled job). */
export async function expirePoints(now = new Date()) {
  const due = await db.loyaltyTransaction.findMany({ where: { type: "EARN", expiresAt: { lte: now } }, orderBy: { id: "asc" }, take: 2000 });
  let expired = 0;
  for (const r of due) {
    const left = r.points - r.consumed;
    if (left <= 0) continue;
    await withTransaction(async (tx) => {
      const fresh = await tx.loyaltyTransaction.findUniqueOrThrow({ where: { id: r.id } });
      const remaining = fresh.points - fresh.consumed;
      if (remaining <= 0) return;
      const c = await tx.customer.findUniqueOrThrow({ where: { id: r.customerId }, select: { loyaltyPoints: true } });
      const take = Math.min(remaining, c.loyaltyPoints);
      await tx.loyaltyTransaction.update({ where: { id: r.id }, data: { consumed: fresh.points } });
      if (take > 0) {
        const balance = c.loyaltyPoints - take;
        await tx.customer.update({ where: { id: r.customerId }, data: { loyaltyPoints: balance } });
        await tx.loyaltyTransaction.create({ data: { customerId: r.customerId, type: "EXPIRE", points: -take, balanceAfter: balance, note: "Points expired" } });
        expired += take;
      }
    });
  }
  return { expired };
}

// ═══ Staff screens ═══════════════════════════════════════════════════════════

export async function customerLoyalty(ctx: Ctx, customerId: string) {
  authorize(ctx, "customers.view");
  const s = await getSetting("loyalty");
  const c = await db.customer.findUnique({ where: { id: customerId }, select: { loyaltyPoints: true } });
  if (!c) throw notFound("Customer");
  const rows = await db.loyaltyTransaction.findMany({ where: { customerId }, orderBy: { id: "desc" }, take: 50 });
  return {
    enabled: s.enabled,
    balance: c.loyaltyPoints,
    value: D(s.pointValue).times(c.loyaltyPoints).toFixed(2),
    history: rows.map((r) => ({ id: r.id.toString(), type: r.type, points: r.points, balanceAfter: r.balanceAfter, note: r.note, createdAt: r.createdAt, expiresAt: r.expiresAt })),
  };
}

const adjustSchema = z.object({ points: z.number().int().min(-100_000).max(100_000).refine((v) => v !== 0, "Enter points to add or remove"), note: z.string().trim().min(3, "Give a reason").max(200) });

export async function adjustPoints(ctx: Ctx, customerId: string, input: unknown) {
  authorize(ctx, "loyalty.manage");
  const r = adjustSchema.safeParse(input);
  if (!r.success) throw validationFailed({ points: r.error.issues.map((i) => i.message) });
  const s = await getSetting("loyalty");
  if (!s.enabled) throw invalidState("Turn on loyalty in Settings first.");
  await withTransaction(async (tx) => {
    await post(tx, { customerId, type: "ADJUST", points: r.data.points, note: r.data.note, userId: ctx.user.id, expiresAt: r.data.points > 0 && s.expiryDays > 0 ? new Date(Date.now() + s.expiryDays * 86_400_000) : null });
    await recordAudit(tx, ctx, { action: "loyalty.adjust", module: "marketing", entityType: "customer", entityId: customerId, after: { points: r.data.points }, reason: r.data.note });
  });
}

/** Points a customer would earn for an amount (shown at checkout). */
export function pointsFor(s: LoyaltySettings, eligible: Prisma.Decimal): number {
  if (!s.enabled || D(s.spendPerPoint).lessThanOrEqualTo(0)) return 0;
  return eligible.div(s.spendPerPoint).floor().toNumber();
}
