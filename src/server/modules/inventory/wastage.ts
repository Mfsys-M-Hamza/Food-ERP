import "server-only";
import { z } from "zod";
import { db, withTransaction, Prisma } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";
import { authorize, authorizeAny } from "@/server/core/rbac";
import { recordAudit } from "@/server/core/audit";
import { notFound, validationFailed } from "@/server/core/errors";
import { zodFieldErrors } from "@/server/core/action";
import { nextSequence, formatDocNumber } from "@/server/core/numbering";
import { getSetting } from "@/server/modules/settings/service";
import { toBase, unitOptions } from "@/lib/units";
import { postMovement } from "./ledger";

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);

export const WASTAGE_REASONS = ["EXPIRED", "BURNED", "DAMAGED", "SPOILED", "WRONG_PREPARATION", "STAFF_MEAL", "OTHER"] as const;

export const wastageSchema = z
  .object({
    kind: z.enum(["INGREDIENT", "PRODUCT"]),
    ingredientId: z.uuid().optional(),
    productId: z.uuid().optional(),
    variantId: z.uuid().nullable().optional(),
    quantity: z.string().trim().regex(/^\d{1,7}(\.\d{1,3})?$/, "Enter a quantity").refine((v) => Number(v) > 0, "Must be more than zero"),
    unit: z.string().trim().max(20).optional().default(""),
    reason: z.enum(WASTAGE_REASONS),
    notes: z.string().trim().max(300).optional().default(""),
    employeeName: z.string().trim().max(80).optional().default(""),
  })
  .superRefine((v, c) => {
    if (v.kind === "INGREDIENT" && !v.ingredientId) c.addIssue({ code: "custom", path: ["ingredientId"], message: "Choose an ingredient" });
    if (v.kind === "PRODUCT" && !v.productId) c.addIssue({ code: "custom", path: ["productId"], message: "Choose a menu item" });
  });

export async function recordWastage(ctx: Ctx, input: unknown) {
  authorize(ctx, "wastage.record");
  const r = wastageSchema.safeParse(input);
  if (!r.success) throw validationFailed(zodFieldErrors(r.error));
  const d = r.data;
  return withTransaction(async (tx) => {
    const prefix = (await getSetting("numbering", tx)).wastagePrefix;
    const number = formatDocNumber(prefix, await nextSequence(tx, ctx.branchId, "WASTAGE", "ALL"));
    let itemName: string;
    let cost = D(0);
    let unit = d.unit;
    let movements: { ingredientId: string; quantity: Prisma.Decimal }[] = [];

    if (d.kind === "INGREDIENT") {
      const ing = await tx.ingredient.findFirst({ where: { id: d.ingredientId, deletedAt: null }, include: { units: true } });
      if (!ing) throw notFound("Ingredient");
      const options = unitOptions(ing.baseUnit, ing.units.map((u) => ({ unit: u.unit, factor: u.factorToBase.toString() })));
      unit = unit || ing.baseUnit;
      if (!options.some((o) => o.unit === unit)) throw validationFailed({ unit: ["Unknown unit"] });
      const base = D(toBase(d.quantity, unit, options).toString());
      movements = [{ ingredientId: ing.id, quantity: base }];
      cost = base.times(ing.averageCost);
      itemName = ing.name;
    } else {
      const p = await tx.product.findFirst({ where: { id: d.productId, deletedAt: null }, include: { variants: { where: { deletedAt: null } } } });
      if (!p) throw notFound("Menu item");
      const v = d.variantId ? p.variants.find((x) => x.id === d.variantId) : null;
      if (d.variantId && !v) throw validationFailed({ variantId: ["Unknown size"] });
      unit = "piece";
      itemName = `${p.name}${v ? ` (${v.name})` : ""}`;
      const recipe = (v && (await tx.recipe.findUnique({ where: { variantId: v.id }, include: { items: true } }))) || (await tx.recipe.findFirst({ where: { productId: p.id }, include: { items: true } }));
      const n = D(d.quantity);
      movements = (recipe?.items ?? []).map((i) => ({ ingredientId: i.ingredientId, quantity: i.quantity.times(n) }));
      cost = (v ? v.cost : p.cost).times(n);
    }

    const w = await tx.wastage.create({
      data: {
        branchId: ctx.branchId,
        wastageNumber: number,
        ingredientId: d.kind === "INGREDIENT" ? d.ingredientId : null,
        productId: d.kind === "PRODUCT" ? d.productId : null,
        variantId: d.kind === "PRODUCT" ? (d.variantId ?? null) : null,
        itemName,
        quantity: d.quantity,
        unit,
        reason: d.reason,
        estimatedCost: cost.toDecimalPlaces(2),
        employeeName: d.employeeName || ctx.user.name,
        recordedById: ctx.user.id,
        notes: d.notes || null,
      },
    });
    for (const m of movements) {
      await postMovement(tx, {
        branchId: ctx.branchId,
        ingredientId: m.ingredientId,
        type: "WASTAGE",
        quantity: m.quantity.negated(),
        referenceType: "wastage",
        referenceId: w.id,
        reason: `${number}: ${d.reason.toLowerCase().replace("_", " ")}`,
        userId: ctx.user.id,
      });
    }
    await recordAudit(tx, ctx, {
      action: "wastage.record",
      module: "inventory",
      entityType: "wastage",
      entityId: w.id,
      after: { item: itemName, quantity: `${d.quantity} ${unit}`, reason: d.reason, cost: cost.toFixed(2) },
    });
    return { id: w.id, wastageNumber: number, estimatedCost: cost.toFixed(2) };
  });
}

export async function listWastage(ctx: Ctx, f: { from?: string; to?: string; reason?: string } = {}) {
  authorizeAny(ctx, ["wastage.record", "inventory.view", "reports.operational"]);
  const where: Prisma.WastageWhereInput = {
    branchId: ctx.branchId,
    ...(f.reason && f.reason !== "all" ? { reason: f.reason as "EXPIRED" } : {}),
    ...(f.from || f.to
      ? { occurredAt: { ...(f.from ? { gte: new Date(`${f.from}T00:00:00+05:00`) } : {}), ...(f.to ? { lt: new Date(new Date(`${f.to}T00:00:00+05:00`).getTime() + 86_400_000) } : {}) } }
      : {}),
  };
  const [rows, totals] = await Promise.all([
    db.wastage.findMany({ where, orderBy: { occurredAt: "desc" }, take: 300 }),
    db.wastage.groupBy({ by: ["reason"], where, _sum: { estimatedCost: true }, _count: { _all: true } }),
  ]);
  return {
    rows: rows.map((w) => ({
      id: w.id,
      wastageNumber: w.wastageNumber,
      itemName: w.itemName,
      quantity: w.quantity.toString(),
      unit: w.unit,
      reason: w.reason,
      estimatedCost: w.estimatedCost.toFixed(2),
      employeeName: w.employeeName,
      occurredAt: w.occurredAt,
      notes: w.notes,
      orderId: w.orderId,
    })),
    byReason: totals.map((t) => ({ reason: t.reason, count: t._count._all, cost: (t._sum.estimatedCost ?? D(0)).toFixed(2) })),
    totalCost: totals.reduce((s, t) => s.plus(t._sum.estimatedCost ?? 0), D(0)).toFixed(2),
  };
}
