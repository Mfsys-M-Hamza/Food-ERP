import "server-only";
import { Prisma, type Db, type Tx } from "@/server/core/db";
import { emit } from "@/server/core/events";

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);

export type Movement = {
  branchId: string;
  ingredientId: string;
  type: "OPENING" | "PURCHASE" | "SALE" | "SALE_REVERSAL" | "WASTAGE" | "ADJUSTMENT" | "COUNT_VARIANCE";
  /** Signed base quantity (+ in, - out). */
  quantity: Prisma.Decimal;
  /** Cost per base unit for incoming stock (purchases). Outgoing uses the average cost. */
  unitCost?: Prisma.Decimal;
  referenceType?: string;
  referenceId?: string;
  reason?: string;
  userId?: string | null;
};

/**
 * Post one stock movement: updates the cached balance, writes the ledger row
 * and keeps the weighted average cost current for purchases. Emits a
 * low-stock event when a movement takes the balance below the minimum.
 * Must run inside the business transaction.
 */
export async function postMovement(tx: Tx, m: Movement) {
  if (m.quantity.isZero()) return null;
  const ing = await tx.ingredient.findUniqueOrThrow({ where: { id: m.ingredientId } });
  // Lock the balance row so concurrent movements serialise.
  await tx.$executeRaw`
    INSERT INTO ingredient_stock (branch_id, ingredient_id, on_hand, updated_at)
    VALUES (${m.branchId}::uuid, ${m.ingredientId}::uuid, 0, now())
    ON CONFLICT (branch_id, ingredient_id) DO NOTHING`;
  const rows = await tx.$queryRaw<{ on_hand: Prisma.Decimal }[]>`
    SELECT on_hand FROM ingredient_stock WHERE branch_id = ${m.branchId}::uuid AND ingredient_id = ${m.ingredientId}::uuid FOR UPDATE`;
  const before = D(rows[0]!.on_hand);
  const after = before.plus(m.quantity);

  let unitCost = ing.averageCost;
  if (m.type === "PURCHASE" && m.unitCost) {
    unitCost = m.unitCost;
    const positiveBefore = Prisma.Decimal.max(before, 0);
    const newAvg = positiveBefore.isZero()
      ? m.unitCost
      : positiveBefore.times(ing.averageCost).plus(m.quantity.times(m.unitCost)).dividedBy(positiveBefore.plus(m.quantity));
    await tx.ingredient.update({
      where: { id: ing.id },
      data: { averageCost: newAvg.toDecimalPlaces(4), lastPurchaseCost: m.unitCost.toDecimalPlaces(4) },
    });
  } else if (m.type === "OPENING" && m.unitCost && ing.averageCost.isZero()) {
    unitCost = m.unitCost;
    await tx.ingredient.update({ where: { id: ing.id }, data: { averageCost: m.unitCost } });
  }

  await tx.ingredientStock.update({
    where: { branchId_ingredientId: { branchId: m.branchId, ingredientId: m.ingredientId } },
    data: { onHand: after },
  });
  const row = await tx.inventoryTransaction.create({
    data: {
      branchId: m.branchId,
      ingredientId: m.ingredientId,
      type: m.type,
      quantity: m.quantity,
      unitCost,
      totalCost: m.quantity.times(unitCost).toDecimalPlaces(2),
      balanceAfter: after,
      referenceType: m.referenceType ?? null,
      referenceId: m.referenceId ?? null,
      reason: m.reason ?? null,
      createdById: m.userId || null,
    },
  });
  if (ing.trackStock && m.quantity.isNegative() && before.greaterThanOrEqualTo(ing.minStock) && after.lessThan(ing.minStock)) {
    await emit(tx, { type: "stock.low", ingredientId: ing.id, branchId: m.branchId });
  }
  return row;
}

/** Recipe cost (Σ quantity × average cost) for one recipe. */
export async function recipeCost(client: Db, recipeId: string): Promise<Prisma.Decimal> {
  const items = await client.recipeItem.findMany({ where: { recipeId }, include: { ingredient: { select: { averageCost: true } } } });
  return items.reduce((s, i) => s.plus(i.quantity.times(i.ingredient.averageCost)), D(0)).toDecimalPlaces(4);
}

/**
 * Push recipe costs into the menu (product / variant / add-on cost), which the
 * POS snapshots on every order line. Limit to recipes using `ingredientIds`.
 */
export async function recomputeMenuCosts(tx: Tx, ingredientIds?: string[]) {
  const recipes = await tx.recipe.findMany({
    where: ingredientIds ? { items: { some: { ingredientId: { in: ingredientIds } } } } : {},
    select: { id: true, productId: true, variantId: true, addonId: true },
  });
  for (const r of recipes) {
    const cost = await recipeCost(tx, r.id);
    if (r.variantId) await tx.productVariant.update({ where: { id: r.variantId }, data: { cost } });
    else if (r.addonId) await tx.addon.update({ where: { id: r.addonId }, data: { cost } });
    else if (r.productId) {
      await tx.product.update({ where: { id: r.productId }, data: { cost } });
      // Variants without their own recipe follow the base recipe.
      const variants = await tx.productVariant.findMany({ where: { productId: r.productId, deletedAt: null }, select: { id: true } });
      const own = await tx.recipe.findMany({ where: { variantId: { in: variants.map((v) => v.id) } }, select: { variantId: true } });
      const without = variants.filter((v) => !own.some((o) => o.variantId === v.id)).map((v) => v.id);
      if (without.length) await tx.productVariant.updateMany({ where: { id: { in: without } }, data: { cost } });
    }
  }
}
