import "server-only";
import { z } from "zod";
import { db, withTransaction, Prisma } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";
import { authorize, authorizeAny } from "@/server/core/rbac";
import { recordAudit, diffObjects } from "@/server/core/audit";
import { invalidState, notFound, validationFailed } from "@/server/core/errors";
import { zodFieldErrors } from "@/server/core/action";
import { nextSequence, formatDocNumber } from "@/server/core/numbering";
import { unitOptions, toBase, type BaseUnit } from "@/lib/units";
import { postMovement, recomputeMenuCosts } from "./ledger";

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);
const qty = z.string().trim().regex(/^\d{1,9}(\.\d{1,3})?$/, "Enter a quantity like 2 or 2.5");
const signedQty = z.string().trim().regex(/^-?\d{1,9}(\.\d{1,3})?$/, "Enter a quantity like 2 or -2.5");
const cost = z.string().trim().regex(/^\d{1,9}(\.\d{1,4})?$/, "Enter a cost like 450 or 0.85");

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw validationFailed(zodFieldErrors(r.error));
  return r.data;
}

// ═══ Ingredients ════════════════════════════════════════════════════════════

export const ingredientSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(60),
  sku: z.string().trim().max(30).optional().default(""),
  category: z.string().trim().max(40).optional().default(""),
  baseUnit: z.enum(["g", "ml", "piece"]),
  minStock: qty.default("0"),
  reorderQty: qty.default("0"),
  defaultSupplierId: z.union([z.uuid(), z.literal("")]).optional().default(""),
  trackStock: z.boolean().default(true),
  isActive: z.boolean().default(true),
  units: z
    .array(z.object({ unit: z.string().trim().min(1).max(20), factor: z.string().trim().regex(/^\d{1,7}(\.\d{1,4})?$/, "Enter a number") }))
    .max(10)
    .default([]),
  /** Only when creating: opening stock in base units and its cost per base unit. */
  openingQty: qty.optional(),
  openingUnitCost: cost.optional(),
});

export type IngredientRow = {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  baseUnit: BaseUnit;
  onHand: string;
  minStock: string;
  reorderQty: string;
  averageCost: string;
  lastPurchaseCost: string | null;
  stockValue: string;
  low: boolean;
  trackStock: boolean;
  isActive: boolean;
  supplierName: string | null;
  usedInRecipes: number;
};

export async function listIngredients(ctx: Ctx, f: { q?: string; filter?: "all" | "low" | "inactive" } = {}): Promise<IngredientRow[]> {
  authorizeAny(ctx, ["inventory.view", "inventory.manage", "recipes.manage", "wastage.record", "purchases.manage"]);
  const q = f.q?.trim();
  const rows = await db.ingredient.findMany({
    where: {
      deletedAt: null,
      ...(f.filter === "inactive" ? { isActive: false } : f.filter === "all" ? {} : { isActive: true }),
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }, { category: { contains: q, mode: "insensitive" } }] } : {}),
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    include: {
      stock: { where: { branchId: ctx.branchId } },
      defaultSupplier: { select: { name: true } },
      _count: { select: { recipeItems: true } },
    },
  });
  const out = rows.map((i) => {
    const onHand = i.stock[0]?.onHand ?? D(0);
    return {
      id: i.id,
      name: i.name,
      sku: i.sku,
      category: i.category,
      baseUnit: i.baseUnit,
      onHand: onHand.toString(),
      minStock: i.minStock.toString(),
      reorderQty: i.reorderQty.toString(),
      averageCost: i.averageCost.toString(),
      lastPurchaseCost: i.lastPurchaseCost?.toString() ?? null,
      stockValue: Prisma.Decimal.max(onHand, 0).times(i.averageCost).toFixed(2),
      low: i.trackStock && onHand.lessThan(i.minStock),
      trackStock: i.trackStock,
      isActive: i.isActive,
      supplierName: i.defaultSupplier?.name ?? null,
      usedInRecipes: i._count.recipeItems,
    };
  });
  return f.filter === "low" ? out.filter((r) => r.low) : out;
}

export async function getIngredient(ctx: Ctx, id: string) {
  authorizeAny(ctx, ["inventory.view", "inventory.manage"]);
  const i = await db.ingredient.findFirst({
    where: { id, deletedAt: null },
    include: { units: true, stock: { where: { branchId: ctx.branchId } }, suppliers: { include: { supplier: { select: { id: true, name: true } } } } },
  });
  if (!i) throw notFound("Ingredient");
  return {
    id: i.id,
    name: i.name,
    sku: i.sku ?? "",
    category: i.category ?? "",
    baseUnit: i.baseUnit,
    minStock: i.minStock.toString(),
    reorderQty: i.reorderQty.toString(),
    defaultSupplierId: i.defaultSupplierId ?? "",
    trackStock: i.trackStock,
    isActive: i.isActive,
    units: i.units.map((u) => ({ unit: u.unit, factor: u.factorToBase.toString() })),
    onHand: (i.stock[0]?.onHand ?? D(0)).toString(),
    averageCost: i.averageCost.toString(),
    lastPurchaseCost: i.lastPurchaseCost?.toString() ?? null,
    suppliers: i.suppliers.map((s) => ({ id: s.supplier.id, name: s.supplier.name, lastUnitCost: s.lastUnitCost?.toString() ?? null, lastPurchasedAt: s.lastPurchasedAt })),
  };
}

export async function saveIngredient(ctx: Ctx, id: string | null, input: unknown): Promise<{ id: string }> {
  authorize(ctx, "inventory.manage");
  const d = parse(ingredientSchema, input);
  return withTransaction(async (tx) => {
    const clash = await tx.ingredient.findFirst({
      where: { deletedAt: null, name: { equals: d.name, mode: "insensitive" }, ...(id ? { id: { not: id } } : {}) },
      select: { id: true },
    });
    if (clash) throw validationFailed({ name: ["An ingredient with this name already exists"] });
    const values = {
      name: d.name,
      sku: d.sku || null,
      category: d.category || null,
      minStock: d.minStock,
      reorderQty: d.reorderQty,
      defaultSupplierId: d.defaultSupplierId || null,
      trackStock: d.trackStock,
      isActive: d.isActive,
    };
    let ingredientId = id;
    if (id) {
      const before = await tx.ingredient.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw notFound("Ingredient");
      if (before.baseUnit !== d.baseUnit) {
        const used = await tx.inventoryTransaction.count({ where: { ingredientId: id } });
        if (used) throw validationFailed({ baseUnit: ["The base unit cannot change once stock has moved"] });
      }
      await tx.ingredient.update({ where: { id }, data: { ...values, baseUnit: d.baseUnit } });
      const diff = diffObjects(
        { name: before.name, minStock: before.minStock.toString(), baseUnit: before.baseUnit, isActive: before.isActive },
        { name: d.name, minStock: D(d.minStock).toString(), baseUnit: d.baseUnit, isActive: d.isActive },
      );
      if (Object.keys(diff.after).length) await recordAudit(tx, ctx, { action: "ingredient.update", module: "inventory", entityType: "ingredient", entityId: id, ...diff });
    } else {
      const created = await tx.ingredient.create({ data: { ...values, baseUnit: d.baseUnit } });
      ingredientId = created.id;
      await recordAudit(tx, ctx, { action: "ingredient.create", module: "inventory", entityType: "ingredient", entityId: created.id, after: { name: d.name, baseUnit: d.baseUnit } });
      if (d.openingQty && D(d.openingQty).greaterThan(0)) {
        await postMovement(tx, {
          branchId: ctx.branchId,
          ingredientId: created.id,
          type: "OPENING",
          quantity: D(d.openingQty),
          unitCost: d.openingUnitCost ? D(d.openingUnitCost) : undefined,
          reason: "Opening stock",
          userId: ctx.user.id,
        });
      }
    }
    await tx.ingredientUnit.deleteMany({ where: { ingredientId: ingredientId! } });
    const generic = unitOptions(d.baseUnit).map((u) => u.unit);
    const custom = d.units.filter((u) => !generic.includes(u.unit) && D(u.factor).greaterThan(0));
    if (custom.length) await tx.ingredientUnit.createMany({ data: custom.map((u) => ({ ingredientId: ingredientId!, unit: u.unit, factorToBase: u.factor })) });
    return { id: ingredientId! };
  });
}

export async function archiveIngredient(ctx: Ctx, id: string) {
  authorize(ctx, "inventory.manage");
  await withTransaction(async (tx) => {
    const i = await tx.ingredient.findFirst({ where: { id, deletedAt: null }, include: { _count: { select: { recipeItems: true } } } });
    if (!i) throw notFound("Ingredient");
    if (i._count.recipeItems) throw invalidState(`Remove “${i.name}” from ${i._count.recipeItems} recipe(s) first.`);
    await tx.ingredient.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await recordAudit(tx, ctx, { action: "ingredient.archive", module: "inventory", entityType: "ingredient", entityId: id, before: { name: i.name } });
  });
}

/** Units the ingredient may be entered in. */
export async function ingredientUnits(ingredientId: string) {
  const i = await db.ingredient.findUniqueOrThrow({ where: { id: ingredientId }, include: { units: true } });
  return unitOptions(i.baseUnit, i.units.map((u) => ({ unit: u.unit, factor: u.factorToBase.toString() })));
}

export async function ingredientLedger(ctx: Ctx, ingredientId: string, limit = 100) {
  authorizeAny(ctx, ["inventory.view", "inventory.manage"]);
  const rows = await db.inventoryTransaction.findMany({
    where: { ingredientId, branchId: ctx.branchId },
    orderBy: { id: "desc" },
    take: Math.min(limit, 500),
  });
  const users = await db.user.findMany({ where: { id: { in: rows.map((r) => r.createdById).filter(Boolean) as string[] } }, select: { id: true, name: true } });
  return rows.map((r) => ({
    id: r.id.toString(),
    type: r.type,
    quantity: r.quantity.toString(),
    unitCost: r.unitCost.toString(),
    totalCost: r.totalCost.toFixed(2),
    balanceAfter: r.balanceAfter.toString(),
    reason: r.reason,
    referenceType: r.referenceType,
    referenceId: r.referenceId,
    createdAt: r.createdAt,
    by: users.find((u) => u.id === r.createdById)?.name ?? null,
  }));
}

// ═══ Adjustments ════════════════════════════════════════════════════════════

export const adjustmentSchema = z.object({
  ingredientId: z.uuid(),
  quantity: signedQty.refine((v) => Number(v) !== 0, "Enter a non-zero quantity"),
  unit: z.string().trim().min(1),
  reason: z.string().trim().min(3, "Give a reason").max(160),
});

export async function adjustStock(ctx: Ctx, input: unknown) {
  authorize(ctx, "inventory.manage");
  const d = parse(adjustmentSchema, input);
  const options = await ingredientUnits(d.ingredientId);
  if (!options.some((o) => o.unit === d.unit)) throw validationFailed({ unit: ["Unknown unit"] });
  const base = toBase(d.quantity, d.unit, options);
  await withTransaction(async (tx) => {
    const row = await postMovement(tx, {
      branchId: ctx.branchId,
      ingredientId: d.ingredientId,
      type: "ADJUSTMENT",
      quantity: D(base.toString()),
      reason: d.reason,
      userId: ctx.user.id,
    });
    await recordAudit(tx, ctx, {
      action: "inventory.adjust",
      module: "inventory",
      entityType: "ingredient",
      entityId: d.ingredientId,
      after: { quantity: `${d.quantity} ${d.unit}`, balanceAfter: row?.balanceAfter.toString() },
      reason: d.reason,
    });
  });
}

// ═══ Stock counts ═══════════════════════════════════════════════════════════

export async function listStockCounts(ctx: Ctx) {
  authorizeAny(ctx, ["inventory.view", "inventory.manage"]);
  const rows = await db.stockCount.findMany({
    where: { branchId: ctx.branchId },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { _count: { select: { items: true } } },
  });
  return rows.map((c) => ({ id: c.id, countNumber: c.countNumber, status: c.status, note: c.note, createdAt: c.createdAt, postedAt: c.postedAt, items: c._count.items }));
}

/** Start a count with every tracked ingredient and its current system quantity. */
export async function startStockCount(ctx: Ctx, note?: string) {
  authorize(ctx, "inventory.manage");
  return withTransaction(async (tx) => {
    const open = await tx.stockCount.findFirst({ where: { branchId: ctx.branchId, status: "DRAFT" } });
    if (open) return { id: open.id };
    const ingredients = await tx.ingredient.findMany({
      where: { deletedAt: null, isActive: true, trackStock: true },
      include: { stock: { where: { branchId: ctx.branchId } } },
    });
    const n = await nextSequence(tx, ctx.branchId, "STOCK_COUNT", "ALL");
    const count = await tx.stockCount.create({
      data: {
        branchId: ctx.branchId,
        countNumber: formatDocNumber("SC", n),
        note: note?.slice(0, 200) || null,
        createdById: ctx.user.id,
        items: {
          create: ingredients.map((i) => ({ ingredientId: i.id, expectedQty: i.stock[0]?.onHand ?? 0, unitCost: i.averageCost })),
        },
      },
    });
    return { id: count.id };
  });
}

export async function getStockCount(ctx: Ctx, id: string) {
  authorizeAny(ctx, ["inventory.view", "inventory.manage"]);
  const c = await db.stockCount.findFirst({
    where: { id, branchId: ctx.branchId },
    include: { items: { include: { ingredient: { select: { name: true, baseUnit: true, category: true } } }, orderBy: { ingredient: { name: "asc" } } } },
  });
  if (!c) throw notFound("Stock count");
  return {
    id: c.id,
    countNumber: c.countNumber,
    status: c.status,
    note: c.note,
    createdAt: c.createdAt,
    postedAt: c.postedAt,
    items: c.items.map((i) => ({
      ingredientId: i.ingredientId,
      name: i.ingredient.name,
      category: i.ingredient.category,
      baseUnit: i.ingredient.baseUnit,
      expectedQty: i.expectedQty.toString(),
      countedQty: i.countedQty?.toString() ?? "",
      varianceQty: i.varianceQty?.toString() ?? null,
      unitCost: i.unitCost.toString(),
    })),
  };
}

const countLinesSchema = z.array(z.object({ ingredientId: z.uuid(), countedQty: z.union([qty, z.literal("")]) })).max(2000);

export async function saveStockCount(ctx: Ctx, id: string, lines: unknown) {
  authorize(ctx, "inventory.manage");
  const data = parse(countLinesSchema, lines);
  await withTransaction(async (tx) => {
    const c = await tx.stockCount.findFirst({ where: { id, branchId: ctx.branchId } });
    if (!c) throw notFound("Stock count");
    if (c.status !== "DRAFT") throw invalidState("This count is already posted.");
    for (const l of data) {
      await tx.stockCountItem.updateMany({
        where: { stockCountId: id, ingredientId: l.ingredientId },
        data: { countedQty: l.countedQty === "" ? null : l.countedQty },
      });
    }
  });
}

/** Post a count: stock is set to the counted quantity; differences are recorded as variances. */
export async function postStockCount(ctx: Ctx, id: string) {
  authorize(ctx, "inventory.manage");
  return withTransaction(async (tx) => {
    const c = await tx.stockCount.findFirst({ where: { id, branchId: ctx.branchId }, include: { items: true } });
    if (!c) throw notFound("Stock count");
    if (c.status !== "DRAFT") throw invalidState("This count is already posted.");
    const counted = c.items.filter((i) => i.countedQty !== null);
    if (counted.length === 0) throw validationFailed({ items: ["Enter at least one counted quantity"] });
    let varianceValue = D(0);
    for (const item of counted) {
      const current = (await tx.ingredientStock.findUnique({ where: { branchId_ingredientId: { branchId: ctx.branchId, ingredientId: item.ingredientId } } }))?.onHand ?? D(0);
      const variance = item.countedQty!.minus(current);
      await tx.stockCountItem.update({ where: { id: item.id }, data: { varianceQty: variance } });
      if (!variance.isZero()) {
        await postMovement(tx, {
          branchId: ctx.branchId,
          ingredientId: item.ingredientId,
          type: "COUNT_VARIANCE",
          quantity: variance,
          referenceType: "stock_count",
          referenceId: id,
          reason: `Stock count ${c.countNumber}`,
          userId: ctx.user.id,
        });
        varianceValue = varianceValue.plus(variance.times(item.unitCost));
      }
    }
    await tx.stockCount.update({ where: { id }, data: { status: "POSTED", postedAt: new Date(), postedById: ctx.user.id } });
    await recordAudit(tx, ctx, {
      action: "inventory.count.post",
      module: "inventory",
      entityType: "stock_count",
      entityId: id,
      after: { counted: counted.length, varianceValue: varianceValue.toFixed(2) },
    });
    return { varianceValue: varianceValue.toFixed(2) };
  });
}

export { recomputeMenuCosts };

/** Ingredients with their entry units (for purchase and wastage forms). */
export async function ingredientOptions(ctx: Ctx) {
  authorizeAny(ctx, ["purchases.manage", "inventory.manage", "wastage.record"]);
  const rows = await db.ingredient.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: "asc" }, include: { units: true } });
  return rows.map((i) => ({
    id: i.id,
    name: i.name,
    baseUnit: i.baseUnit,
    defaultSupplierId: i.defaultSupplierId,
    lastPurchaseCost: i.lastPurchaseCost?.toString() ?? null,
    units: unitOptions(i.baseUnit, i.units.map((u) => ({ unit: u.unit, factor: u.factorToBase.toString() }))),
  }));
}
