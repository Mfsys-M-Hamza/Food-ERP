import "server-only";
import { z } from "zod";
import { db, withTransaction, Prisma, type Tx } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";
import { authorize, authorizeAny } from "@/server/core/rbac";
import { recordAudit } from "@/server/core/audit";
import { notFound, validationFailed } from "@/server/core/errors";
import { zodFieldErrors } from "@/server/core/action";
import { recipeCost } from "./ledger";


export type RecipeOverviewRow = {
  productId: string;
  name: string;
  category: string;
  price: string;
  cost: string;
  foodCostPercent: number | null;
  hasRecipe: boolean;
  variantsWithRecipe: number;
  variantCount: number;
};

export async function listRecipeOverview(ctx: Ctx): Promise<RecipeOverviewRow[]> {
  authorizeAny(ctx, ["recipes.manage", "inventory.view"]);
  const products = await db.product.findMany({
    where: { deletedAt: null },
    orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }],
    include: { category: { select: { name: true } }, variants: { where: { deletedAt: null }, select: { id: true } } },
  });
  const recipes = await db.recipe.findMany({ where: { OR: [{ productId: { in: products.map((p) => p.id) } }, { variantId: { not: null } }] }, select: { productId: true, variantId: true } });
  return products.map((p) => {
    const price = p.basePrice;
    const pct = price.isZero() ? null : p.cost.dividedBy(price).times(100).toDecimalPlaces(0).toNumber();
    return {
      productId: p.id,
      name: p.name,
      category: p.category.name,
      price: price.toFixed(2),
      cost: p.cost.toFixed(2),
      foodCostPercent: pct,
      hasRecipe: recipes.some((r) => r.productId === p.id),
      variantsWithRecipe: p.variants.filter((v) => recipes.some((r) => r.variantId === v.id)).length,
      variantCount: p.variants.length,
    };
  });
}

export async function getRecipeEditor(ctx: Ctx, productId: string) {
  authorizeAny(ctx, ["recipes.manage", "inventory.view"]);
  const p = await db.product.findFirst({
    where: { id: productId, deletedAt: null },
    include: {
      variants: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
      removables: { orderBy: { sortOrder: "asc" } },
      addonGroups: { orderBy: { sortOrder: "asc" }, include: { group: { include: { addons: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } } } } } },
    },
  });
  if (!p) throw notFound("Product");
  const addonIds = p.addonGroups.flatMap((g) => g.group.addons.map((a) => a.id));
  const recipes = await db.recipe.findMany({
    where: { OR: [{ productId }, { variantId: { in: p.variants.map((v) => v.id) } }, { addonId: { in: addonIds } }] },
    include: { items: true },
  });
  const ingredients = await db.ingredient.findMany({
    where: { deletedAt: null, isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, baseUnit: true, averageCost: true },
  });
  const items = (r?: (typeof recipes)[number]) => (r?.items ?? []).map((i) => ({ ingredientId: i.ingredientId, quantity: i.quantity.toString() }));
  return {
    product: { id: p.id, name: p.name, price: p.basePrice.toFixed(2) },
    base: items(recipes.find((r) => r.productId === productId)),
    variants: p.variants.map((v) => ({ id: v.id, name: v.name, price: v.price.toFixed(2), items: items(recipes.find((r) => r.variantId === v.id)), hasOwn: recipes.some((r) => r.variantId === v.id) })),
    addons: p.addonGroups.flatMap((g) =>
      g.group.addons.map((a) => ({ id: a.id, name: a.name, groupName: g.group.name, price: a.price.toFixed(2), items: items(recipes.find((r) => r.addonId === a.id)) })),
    ),
    removables: p.removables.map((r) => ({ id: r.id, label: r.label, ingredientId: r.ingredientId })),
    ingredients: ingredients.map((i) => ({ id: i.id, name: i.name, baseUnit: i.baseUnit, averageCost: i.averageCost.toString() })),
  };
}

export const saveRecipeSchema = z.object({
  target: z.union([z.object({ productId: z.uuid() }), z.object({ variantId: z.uuid() }), z.object({ addonId: z.uuid() })]),
  items: z
    .array(z.object({ ingredientId: z.uuid(), quantity: z.string().trim().regex(/^\d{1,7}(\.\d{1,3})?$/, "Enter a quantity") }))
    .max(40)
    .refine((items) => new Set(items.map((i) => i.ingredientId)).size === items.length, "An ingredient is listed twice"),
});

async function applyCost(tx: Tx, target: { productId?: string; variantId?: string; addonId?: string }, cost: Prisma.Decimal | null) {
  if (target.variantId) {
    const base = cost ?? (await baseCostForVariant(tx, target.variantId));
    if (base) await tx.productVariant.update({ where: { id: target.variantId }, data: { cost: base } });
  } else if (target.addonId) {
    if (cost) await tx.addon.update({ where: { id: target.addonId }, data: { cost } });
  } else if (target.productId && cost) {
    await tx.product.update({ where: { id: target.productId }, data: { cost } });
    const variants = await tx.productVariant.findMany({ where: { productId: target.productId, deletedAt: null }, select: { id: true } });
    for (const v of variants) {
      if (!(await tx.recipe.findUnique({ where: { variantId: v.id } }))) await tx.productVariant.update({ where: { id: v.id }, data: { cost } });
    }
  }
}

async function baseCostForVariant(tx: Tx, variantId: string) {
  const v = await tx.productVariant.findUniqueOrThrow({ where: { id: variantId }, select: { productId: true } });
  const base = await tx.recipe.findFirst({ where: { productId: v.productId } });
  return base ? recipeCost(tx, base.id) : null;
}

/** Save (or clear) one recipe and push its cost into the menu. */
export async function saveRecipe(ctx: Ctx, input: unknown) {
  authorize(ctx, "recipes.manage");
  const r = saveRecipeSchema.safeParse(input);
  if (!r.success) throw validationFailed(zodFieldErrors(r.error));
  const { target, items } = r.data;
  const where = "productId" in target ? { productId: target.productId } : "variantId" in target ? { variantId: target.variantId } : { addonId: target.addonId };
  return withTransaction(async (tx) => {
    // Target must exist.
    const exists =
      "productId" in target
        ? await tx.product.findFirst({ where: { id: target.productId, deletedAt: null } })
        : "variantId" in target
          ? await tx.productVariant.findFirst({ where: { id: target.variantId, deletedAt: null } })
          : await tx.addon.findFirst({ where: { id: target.addonId, deletedAt: null } });
    if (!exists) throw notFound("Recipe target");
    const ingredients = await tx.ingredient.count({ where: { id: { in: items.map((i) => i.ingredientId) }, deletedAt: null } });
    if (ingredients !== items.length) throw validationFailed({ items: ["An ingredient no longer exists"] });

    const current = await tx.recipe.findFirst({ where, include: { items: true } });
    const before = current?.items.map((i) => ({ ingredientId: i.ingredientId, quantity: i.quantity.toString() })) ?? [];
    let cost: Prisma.Decimal | null = null;
    if (items.length === 0) {
      if (current) await tx.recipe.delete({ where: { id: current.id } });
    } else {
      const recipe = current ?? (await tx.recipe.create({ data: where }));
      await tx.recipeItem.deleteMany({ where: { recipeId: recipe.id } });
      await tx.recipeItem.createMany({ data: items.map((i) => ({ recipeId: recipe.id, ingredientId: i.ingredientId, quantity: i.quantity })) });
      cost = await recipeCost(tx, recipe.id);
    }
    await applyCost(tx, target as never, cost);
    await recordAudit(tx, ctx, {
      action: "recipe.save",
      module: "recipes",
      entityType: Object.keys(target)[0]!.replace("Id", ""),
      entityId: Object.values(target)[0] as string,
      before: { items: before },
      after: { items, cost: cost?.toFixed(2) ?? null },
    });
    return { cost: cost?.toFixed(2) ?? null };
  });
}

/** Link "No onions" to the onions ingredient so it is not deducted. */
export async function setRemovableIngredient(ctx: Ctx, removableId: string, ingredientId: string | null) {
  authorize(ctx, "recipes.manage");
  if (!z.uuid().safeParse(removableId).success) throw validationFailed({ removableId: ["Invalid"] });
  if (ingredientId && !z.uuid().safeParse(ingredientId).success) throw validationFailed({ ingredientId: ["Invalid"] });
  await withTransaction(async (tx) => {
    const r = await tx.productRemovableOption.findUnique({ where: { id: removableId } });
    if (!r) throw notFound("Option");
    await tx.productRemovableOption.update({ where: { id: removableId }, data: { ingredientId } });
    await recordAudit(tx, ctx, { action: "recipe.removable_link", module: "recipes", entityType: "removable", entityId: removableId, after: { label: r.label, ingredientId } });
  });
}
