import "server-only";
import { Prisma, type Tx } from "@/server/core/db";
import { nextSequence, formatDocNumber } from "@/server/core/numbering";
import { getSetting } from "@/server/modules/settings/service";
import { onOrderStatusChange } from "@/server/modules/orders/hooks";
import { postMovement } from "./ledger";

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);
const RANK: Record<string, number> = { NEW: 0, ACCEPTED: 1, PREPARING: 2, READY: 3, OUT_FOR_DELIVERY: 4, COMPLETED: 5 };

/**
 * Ingredients used by one order (base units):
 *   size recipe, else product recipe   × quantity
 * + each chosen add-on's recipe        × quantity
 * − ingredients of removed options (e.g. "No onions") from the base recipe.
 */
export async function orderConsumption(tx: Tx, orderId: string): Promise<Map<string, Prisma.Decimal>> {
  const items = await tx.orderItem.findMany({ where: { orderId }, include: { addons: true, removals: true } });
  const productIds = [...new Set(items.map((i) => i.productId))];
  const variantIds = items.map((i) => i.variantId).filter(Boolean) as string[];
  const addonIds = [...new Set(items.flatMap((i) => i.addons.map((a) => a.addonId)))];
  const removalIds = items.flatMap((i) => i.removals.map((r) => r.removableOptionId)).filter(Boolean) as string[];
  const recipes = await tx.recipe.findMany({
    where: { OR: [{ productId: { in: productIds } }, { variantId: { in: variantIds } }, { addonId: { in: addonIds } }] },
    include: { items: true },
  });
  const removables = await tx.productRemovableOption.findMany({ where: { id: { in: removalIds } }, select: { id: true, ingredientId: true } });
  const total = new Map<string, Prisma.Decimal>();
  const add = (ingredientId: string, q: Prisma.Decimal) => total.set(ingredientId, (total.get(ingredientId) ?? D(0)).plus(q));

  for (const item of items) {
    const base = (item.variantId && recipes.find((r) => r.variantId === item.variantId)) || recipes.find((r) => r.productId === item.productId);
    const removed = new Set(
      item.removals.map((r) => removables.find((x) => x.id === r.removableOptionId)?.ingredientId).filter(Boolean) as string[],
    );
    for (const ri of base?.items ?? []) {
      if (!removed.has(ri.ingredientId)) add(ri.ingredientId, ri.quantity.times(item.quantity));
    }
    for (const a of item.addons) {
      const r = recipes.find((x) => x.addonId === a.addonId);
      for (const ri of r?.items ?? []) add(ri.ingredientId, ri.quantity.times(a.quantity).times(item.quantity));
    }
  }
  return total;
}

async function deduct(tx: Tx, orderId: string, userId: string | null) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { branchId: true, stockDeductedAt: true, orderNumber: true } });
  if (order.stockDeductedAt) return;
  const usage = await orderConsumption(tx, orderId);
  for (const [ingredientId, qty] of usage) {
    await postMovement(tx, {
      branchId: order.branchId,
      ingredientId,
      type: "SALE",
      quantity: qty.negated(),
      referenceType: "order",
      referenceId: orderId,
      reason: `Order ${order.orderNumber}`,
      userId,
    });
  }
  await tx.order.update({ where: { id: orderId }, data: { stockDeductedAt: new Date() } });
}

/** Food already made for a cancelled order is recorded as wastage, not returned to stock. */
async function wasteCancelled(tx: Tx, orderId: string, userId: string | null) {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order.stockDeductedAt) return;
  const already = await tx.wastage.count({ where: { orderId, reason: "CANCELLED_ORDER" } });
  if (already) return;
  const usage = await orderConsumption(tx, orderId);
  const prefix = (await getSetting("numbering", tx)).wastagePrefix;
  for (const item of order.items) {
    const n = await nextSequence(tx, order.branchId, "WASTAGE", "ALL");
    await tx.wastage.create({
      data: {
        branchId: order.branchId,
        wastageNumber: formatDocNumber(prefix, n),
        productId: item.productId,
        variantId: item.variantId,
        itemName: `${item.productName}${item.variantName ? ` (${item.variantName})` : ""}`,
        orderId,
        quantity: item.quantity,
        unit: "piece",
        reason: "CANCELLED_ORDER",
        estimatedCost: item.unitCostEstimate.times(item.quantity).toDecimalPlaces(2),
        recordedById: userId,
        notes: `Order ${order.orderNumber} cancelled after preparation started`,
      },
    });
  }
  for (const [ingredientId, qty] of usage) {
    const common = { branchId: order.branchId, ingredientId, referenceType: "order", referenceId: orderId, userId };
    await postMovement(tx, { ...common, type: "SALE_REVERSAL", quantity: qty, reason: `Order ${order.orderNumber} cancelled` });
    await postMovement(tx, { ...common, type: "WASTAGE", quantity: qty.negated(), reason: `Order ${order.orderNumber} cancelled (food made)` });
  }
}

onOrderStatusChange(async (tx, change) => {
  const userId = change.ctx?.user.id || null;
  if (change.to === "CANCELLED") return wasteCancelled(tx, change.orderId, userId);
  const point = (await getSetting("inventory", tx)).deductionPoint;
  if ((RANK[change.to] ?? -1) >= RANK[point]!) await deduct(tx, change.orderId, userId);
});
