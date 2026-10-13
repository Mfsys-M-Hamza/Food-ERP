import "server-only";
import { db } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";
import { authorizeAny } from "@/server/core/rbac";
import { KITCHEN_STATUSES, type OrderStatus } from "@/server/modules/orders/state-machine";

/** What the kitchen sees: preparation details only (no prices, no phone numbers). */
export type KitchenTicket = {
  id: string;
  displayNumber: number;
  status: OrderStatus;
  type: "TAKEAWAY" | "DELIVERY" | "DINE_IN";
  source: string;
  tableLabel: string | null;
  customerFirstName: string | null;
  createdAt: string;
  acceptedAt: string | null;
  preparingAt: string | null;
  readyAt: string | null;
  estimatedReadyAt: string | null;
  scheduledFor: string | null;
  kitchenNote: string | null;
  version: number;
  items: {
    id: string;
    quantity: number;
    name: string;
    variant: string | null;
    addons: string[];
    removals: string[];
    note: string | null;
  }[];
};

export async function listKitchenTickets(ctx: Ctx): Promise<KitchenTicket[]> {
  authorizeAny(ctx, ["kitchen.view", "kitchen.update"]);
  const since = new Date(Date.now() - 18 * 3_600_000);
  const orders = await db.order.findMany({
    where: { branchId: ctx.branchId, status: { in: KITCHEN_STATUSES }, createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
    take: 200,
    include: { items: { orderBy: { sortOrder: "asc" }, include: { addons: true, removals: true } } },
  });
  return orders.map((o) => ({
    id: o.id,
    displayNumber: o.displayNumber,
    status: o.status as OrderStatus,
    type: o.type,
    source: o.source,
    tableLabel: o.tableLabel,
    customerFirstName: o.customerName?.split(/\s+/)[0] ?? null,
    createdAt: o.createdAt.toISOString(),
    acceptedAt: o.acceptedAt?.toISOString() ?? null,
    preparingAt: o.preparingAt?.toISOString() ?? null,
    readyAt: o.readyAt?.toISOString() ?? null,
    estimatedReadyAt: o.estimatedReadyAt?.toISOString() ?? null,
    scheduledFor: o.scheduledFor?.toISOString() ?? null,
    kitchenNote: o.kitchenNote,
    version: o.version,
    items: o.items.map((i) => ({
      id: i.id,
      quantity: i.quantity,
      name: i.productName,
      variant: i.variantName,
      addons: i.addons.map((a) => a.addonName),
      removals: i.removals.map((r) => r.label),
      note: i.note,
    })),
  }));
}

/** Order-ready board: numbers only. */
export async function listBoardNumbers(ctx: Ctx) {
  authorizeAny(ctx, ["kitchen.view", "pos.use"]);
  const since = new Date(Date.now() - 6 * 3_600_000);
  const rows = await db.order.findMany({
    where: {
      branchId: ctx.branchId,
      type: { not: "DELIVERY" },
      OR: [
        { status: { in: ["ACCEPTED", "PREPARING"] }, createdAt: { gte: since } },
        { status: "READY", readyAt: { gte: since } },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: { displayNumber: true, status: true },
  });
  return {
    preparing: rows.filter((r) => r.status !== "READY").map((r) => r.displayNumber),
    ready: rows.filter((r) => r.status === "READY").map((r) => r.displayNumber),
  };
}
