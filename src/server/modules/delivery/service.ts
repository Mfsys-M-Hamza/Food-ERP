import "server-only";
import { z } from "zod";
import { db, withTransaction, Prisma } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";
import { buildContext } from "@/server/core/context";
import { authorize, authorizeAny, can } from "@/server/core/rbac";
import { recordAudit } from "@/server/core/audit";
import { emit } from "@/server/core/events";
import { forbidden, invalidState, notFound, validationFailed } from "@/server/core/errors";
import { zodFieldErrors } from "@/server/core/action";
import { getOpenShift } from "@/server/modules/shifts/service";
import { transitionInTx, loadOrderDetail } from "@/server/modules/orders/service";

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);

/** Staff who can take deliveries (active users holding delivery.rider). */
export async function listRiders(ctx: Ctx) {
  authorize(ctx, "delivery.assign");
  const users = await db.user.findMany({
    where: {
      kind: "STAFF",
      status: "ACTIVE",
      userRoles: { some: { role: { permissions: { some: { permission: { key: "delivery.rider" } } } } } },
    },
    select: { id: true, name: true, phone: true },
    orderBy: { name: "asc" },
  });
  const active = await db.delivery.groupBy({
    by: ["riderId"],
    where: { riderId: { in: users.map((u) => u.id) }, status: { in: ["ASSIGNED", "OUT_FOR_DELIVERY"] } },
    _count: { _all: true },
  });
  return users.map((u) => ({ ...u, activeDeliveries: active.find((a) => a.riderId === u.id)?._count._all ?? 0 }));
}

export async function assignRider(ctx: Ctx, orderId: string, riderId: string | null) {
  authorize(ctx, "delivery.assign");
  await withTransaction(async (tx) => {
    const delivery = await tx.delivery.findUnique({ where: { orderId }, include: { order: true } });
    if (!delivery || delivery.branchId !== ctx.branchId) throw notFound("Delivery");
    if (["DELIVERED", "FAILED", "RETURNED"].includes(delivery.status) || ["COMPLETED", "CANCELLED"].includes(delivery.order.status)) {
      throw invalidState("This delivery is already finished.");
    }
    if (riderId) {
      const rider = await buildContext(riderId);
      if (!rider || !can(rider, "delivery.rider")) throw validationFailed({ riderId: ["Choose a rider"] });
    }
    if (delivery.order.status === "OUT_FOR_DELIVERY" && !riderId) throw invalidState("The order is already out for delivery.");
    await tx.delivery.update({
      where: { orderId },
      data: { riderId, status: riderId ? "ASSIGNED" : "PENDING", assignedAt: riderId ? new Date() : null },
    });
    await recordAudit(tx, ctx, {
      action: "delivery.assign",
      module: "delivery",
      entityType: "order",
      entityId: orderId,
      before: { riderId: delivery.riderId },
      after: { riderId },
    });
    if (riderId) await emit(tx, { type: "delivery.assigned", orderId, branchId: delivery.branchId, riderId });
  });
  return loadOrderDetail(orderId);
}

export type RiderDelivery = {
  orderId: string;
  displayNumber: number;
  orderNumber: string;
  orderStatus: string;
  deliveryStatus: string;
  recipientName: string;
  phone: string;
  addressText: string;
  landmark: string | null;
  mapUrl: string | null;
  zoneName: string | null;
  codAmount: string;
  grandTotal: string;
  itemSummary: string;
  createdAt: Date;
  readyAt: Date | null;
  deliveredAt: Date | null;
  notes: string | null;
};

/** A rider sees only deliveries assigned to them. */
export async function listMyDeliveries(ctx: Ctx, scope: "active" | "today" = "active"): Promise<RiderDelivery[]> {
  authorize(ctx, "delivery.rider");
  const rows = await db.delivery.findMany({
    where: {
      riderId: ctx.user.id,
      ...(scope === "active"
        ? { status: { in: ["ASSIGNED", "OUT_FOR_DELIVERY"] } }
        : { createdAt: { gte: new Date(Date.now() - 24 * 3_600_000) } }),
    },
    orderBy: { assignedAt: "asc" },
    include: {
      zone: { select: { name: true } },
      order: { include: { items: { select: { quantity: true, productName: true, variantName: true } } } },
    },
  });
  return rows.map((d) => ({
    orderId: d.orderId,
    displayNumber: d.order.displayNumber,
    orderNumber: d.order.orderNumber,
    orderStatus: d.order.status,
    deliveryStatus: d.status,
    recipientName: d.recipientName,
    phone: d.phone,
    addressText: d.addressText,
    landmark: d.landmark,
    mapUrl: d.mapUrl,
    zoneName: d.zone?.name ?? null,
    codAmount: d.codAmount.toFixed(2),
    grandTotal: d.order.grandTotal.toFixed(2),
    itemSummary: d.order.items.map((i) => `${i.quantity}× ${i.productName}${i.variantName ? ` (${i.variantName})` : ""}`).join(", "),
    createdAt: d.order.createdAt,
    readyAt: d.order.readyAt,
    deliveredAt: d.deliveredAt,
    notes: d.notes,
  }));
}

const riderActionSchema = z.object({
  action: z.enum(["PICKED_UP", "DELIVERED", "FAILED"]),
  note: z.string().trim().max(200).optional().default(""),
});

/** Rider updates their own delivery. */
export async function riderUpdate(ctx: Ctx, orderId: string, input: unknown) {
  authorize(ctx, "delivery.rider");
  const r = riderActionSchema.safeParse(input);
  if (!r.success) throw validationFailed(zodFieldErrors(r.error));
  const { action, note } = r.data;
  await withTransaction(async (tx) => {
    const d = await tx.delivery.findUnique({ where: { orderId }, include: { order: true } });
    if (!d) throw notFound("Delivery");
    if (d.riderId !== ctx.user.id) throw forbidden("This delivery is not assigned to you.");
    if (action === "PICKED_UP") {
      if (d.order.status !== "READY") throw invalidState("The kitchen has not marked this order ready yet.");
      await transitionInTx(tx, ctx, orderId, "OUT_FOR_DELIVERY", { source: "RIDER" });
    } else if (action === "DELIVERED") {
      if (d.order.status !== "OUT_FOR_DELIVERY") throw invalidState("Mark the order as picked up first.");
      await transitionInTx(tx, ctx, orderId, "COMPLETED", { source: "RIDER" });
      if (note) await tx.delivery.update({ where: { orderId }, data: { notes: note } });
    } else {
      if (note.length < 3) throw validationFailed({ note: ["Say what went wrong"] });
      await tx.delivery.update({ where: { orderId }, data: { status: "FAILED", notes: note } });
      await tx.orderStatusHistory.create({
        data: { orderId, fromStatus: d.order.status, toStatus: d.order.status, changedById: ctx.user.id, source: "RIDER", reason: `Delivery failed: ${note}` },
      });
      await recordAudit(tx, ctx, { action: "delivery.failed", module: "delivery", entityType: "order", entityId: orderId, reason: note });
      await emit(tx, { type: "order.status_changed", orderId, branchId: d.branchId, from: d.order.status, to: d.order.status });
    }
  });
}

/** Cash a rider is carrying: delivered COD orders not yet handed in. */
export async function listUnsettledCash(ctx: Ctx) {
  authorize(ctx, "delivery.settle");
  const rows = await db.delivery.findMany({
    where: {
      branchId: ctx.branchId,
      riderId: { not: null },
      status: "DELIVERED",
      codAmount: { gt: 0 },
      codSettledAt: null,
    },
    include: { rider: { select: { id: true, name: true } }, order: { select: { displayNumber: true, orderNumber: true, grandTotal: true, amountPaid: true } } },
    orderBy: { deliveredAt: "asc" },
  });
  const byRider = new Map<string, { riderId: string; riderName: string; total: Prisma.Decimal; deliveries: { orderId: string; displayNumber: number; amount: string; deliveredAt: Date | null }[] }>();
  for (const d of rows) {
    const key = d.rider!.id;
    const entry = byRider.get(key) ?? { riderId: key, riderName: d.rider!.name, total: D(0), deliveries: [] };
    const due = d.order.grandTotal.minus(d.order.amountPaid);
    entry.total = entry.total.plus(due);
    entry.deliveries.push({ orderId: d.orderId, displayNumber: d.order.displayNumber, amount: due.toFixed(2), deliveredAt: d.deliveredAt });
    byRider.set(key, entry);
  }
  return [...byRider.values()].map((e) => ({ ...e, total: e.total.toFixed(2) }));
}

const settleSchema = z.object({
  riderId: z.uuid(),
  orderIds: z.array(z.uuid()).min(1).max(100),
  terminalId: z.uuid(),
});

/** Rider hands in cash: each order is paid in cash into the till's open shift. */
export async function settleRiderCash(ctx: Ctx, input: unknown) {
  authorize(ctx, "delivery.settle");
  const r = settleSchema.safeParse(input);
  if (!r.success) throw validationFailed(zodFieldErrors(r.error));
  const { riderId, orderIds, terminalId } = r.data;
  return withTransaction(async (tx) => {
    const shift = await getOpenShift(terminalId, tx);
    if (!shift || shift.branchId !== ctx.branchId) throw invalidState("Open a cash shift on this till before taking rider cash.");
    let total = D(0);
    for (const orderId of orderIds) {
      const d = await tx.delivery.findUnique({ where: { orderId }, include: { order: true } });
      if (!d || d.riderId !== riderId) throw validationFailed({ orderIds: ["A delivery does not belong to this rider"] });
      if (d.codSettledAt) throw invalidState(`Order #${d.order.displayNumber} is already settled.`);
      const due = d.order.grandTotal.minus(d.order.amountPaid);
      if (due.lessThanOrEqualTo(0)) continue;
      const payment = await tx.payment.create({
        data: {
          branchId: d.branchId,
          orderId,
          cashShiftId: shift.id,
          method: "CASH",
          amount: due,
          tendered: due,
          changeGiven: 0,
          receivedById: ctx.user.id,
          provider: "RIDER",
        },
      });
      await tx.cashTransaction.create({
        data: {
          cashShiftId: shift.id,
          type: "RIDER_SETTLEMENT",
          amount: due,
          referenceType: "payment",
          referenceId: payment.id,
          reason: `Rider cash for #${d.order.displayNumber}`,
          createdById: ctx.user.id,
        },
      });
      await tx.order.update({
        where: { id: orderId },
        data: { amountPaid: d.order.grandTotal, paymentStatus: "PAID", version: { increment: 1 } },
      });
      await tx.delivery.update({ where: { orderId }, data: { codSettledAt: new Date(), codSettledShiftId: shift.id } });
      total = total.plus(due);
    }
    await recordAudit(tx, ctx, {
      action: "delivery.settle_cash",
      module: "delivery",
      entityType: "cash_shift",
      entityId: shift.id,
      after: { riderId, orders: orderIds.length, amount: total.toFixed(2) },
    });
    return { total: total.toFixed(2), count: orderIds.length };
  });
}

/** Admin board: every delivery that is not finished, plus today's delivered ones. */
export async function deliveryBoard(ctx: Ctx) {
  authorizeAny(ctx, ["delivery.assign", "delivery.manage"]);
  const since = new Date(Date.now() - 18 * 3_600_000);
  const rows = await db.delivery.findMany({
    where: {
      branchId: ctx.branchId,
      OR: [
        { order: { status: { in: ["NEW", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY"] } } },
        { status: { in: ["DELIVERED", "FAILED", "RETURNED"] }, updatedAt: { gte: since } },
      ],
    },
    include: {
      rider: { select: { name: true } },
      zone: { select: { name: true } },
      order: { select: { id: true, displayNumber: true, orderNumber: true, status: true, grandTotal: true, amountPaid: true, createdAt: true, readyAt: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const now = Date.now();
  const card = (d: (typeof rows)[number]) => ({
    orderId: d.order.id,
    displayNumber: d.order.displayNumber,
    orderStatus: d.order.status,
    status: d.status,
    rider: d.rider?.name ?? null,
    zone: d.zone?.name ?? null,
    recipient: d.recipientName,
    phone: d.phone,
    address: d.addressText,
    landmark: d.landmark,
    mapUrl: d.mapUrl,
    due: d.order.grandTotal.minus(d.order.amountPaid).toFixed(2),
    total: d.order.grandTotal.toFixed(2),
    minutes: Math.floor((now - d.order.createdAt.getTime()) / 60_000),
    deliveredAt: d.deliveredAt,
  });
  const open = rows.filter((d) => !["DELIVERED", "FAILED", "RETURNED"].includes(d.status));
  return {
    waiting: open.filter((d) => !d.riderId && d.order.status !== "OUT_FOR_DELIVERY").map(card),
    assigned: open.filter((d) => d.riderId && d.order.status !== "OUT_FOR_DELIVERY").map(card),
    onTheRoad: open.filter((d) => d.order.status === "OUT_FOR_DELIVERY").map(card),
    done: rows.filter((d) => ["DELIVERED", "FAILED", "RETURNED"].includes(d.status)).map(card).reverse(),
  };
}
