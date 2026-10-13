import "server-only";
import { z } from "zod";
import { db, withTransaction } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";
import { authorize } from "@/server/core/rbac";
import { recordAudit } from "@/server/core/audit";
import { notFound, validationFailed } from "@/server/core/errors";
import { zodFieldErrors } from "@/server/core/action";

const money = z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/, "Enter a valid amount");

export const zoneSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(60),
  charge: money,
  minimumOrder: money.default("0"),
  freeAbove: z.union([money, z.literal("")]).optional().default(""),
  estimatedMinutes: z.coerce.number().int().min(5).max(240),
  isActive: z.boolean().default(true),
});

export type ZoneRow = {
  id: string;
  name: string;
  charge: string;
  minimumOrder: string;
  freeAbove: string;
  estimatedMinutes: number;
  isActive: boolean;
};

/** Zones are needed by order taking (POS, website), so reading them is not restricted. */
export async function listZones(branchId: string, opts: { activeOnly?: boolean } = {}): Promise<ZoneRow[]> {
  const rows = await db.deliveryZone.findMany({
    where: { branchId, deletedAt: null, ...(opts.activeOnly ? { isActive: true } : {}) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return rows.map((z) => ({
    id: z.id,
    name: z.name,
    charge: z.charge.toFixed(2),
    minimumOrder: z.minimumOrder.toFixed(2),
    freeAbove: z.freeAbove?.toFixed(2) ?? "",
    estimatedMinutes: z.estimatedMinutes,
    isActive: z.isActive,
  }));
}

export async function saveZone(ctx: Ctx, id: string | null, input: unknown): Promise<{ id: string }> {
  authorize(ctx, "delivery.manage");
  const r = zoneSchema.safeParse(input);
  if (!r.success) throw validationFailed(zodFieldErrors(r.error));
  const d = r.data;
  const values = {
    name: d.name,
    charge: d.charge,
    minimumOrder: d.minimumOrder,
    freeAbove: d.freeAbove || null,
    estimatedMinutes: d.estimatedMinutes,
    isActive: d.isActive,
  };
  return withTransaction(async (tx) => {
    let zoneId = id;
    if (id) {
      const before = await tx.deliveryZone.findFirst({ where: { id, branchId: ctx.branchId, deletedAt: null } });
      if (!before) throw notFound("Zone");
      await tx.deliveryZone.update({ where: { id }, data: values });
      await recordAudit(tx, ctx, {
        action: "delivery_zone.update",
        module: "delivery",
        entityType: "delivery_zone",
        entityId: id,
        before: { name: before.name, charge: before.charge.toFixed(2), minimumOrder: before.minimumOrder.toFixed(2) },
        after: { name: d.name, charge: d.charge, minimumOrder: d.minimumOrder },
      });
    } else {
      const max = await tx.deliveryZone.aggregate({ _max: { sortOrder: true }, where: { branchId: ctx.branchId } });
      const z2 = await tx.deliveryZone.create({ data: { ...values, branchId: ctx.branchId, sortOrder: (max._max.sortOrder ?? 0) + 10 } });
      zoneId = z2.id;
      await recordAudit(tx, ctx, { action: "delivery_zone.create", module: "delivery", entityType: "delivery_zone", entityId: z2.id, after: d });
    }
    return { id: zoneId! };
  });
}

export async function archiveZone(ctx: Ctx, id: string): Promise<void> {
  authorize(ctx, "delivery.manage");
  await withTransaction(async (tx) => {
    const z2 = await tx.deliveryZone.findFirst({ where: { id, branchId: ctx.branchId, deletedAt: null } });
    if (!z2) throw notFound("Zone");
    await tx.deliveryZone.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await recordAudit(tx, ctx, { action: "delivery_zone.archive", module: "delivery", entityType: "delivery_zone", entityId: id, before: { name: z2.name } });
  });
}
