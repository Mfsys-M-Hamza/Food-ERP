import "server-only";
import { z } from "zod";
import { db, withTransaction } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";
import { authorize } from "@/server/core/rbac";
import { notFound, validationFailed } from "@/server/core/errors";
import { zodFieldErrors } from "@/server/core/action";

/** Parked POS carts. Not financial records: a held cart is deleted when resumed. */
export const holdSchema = z.object({
  terminalId: z.uuid().nullable().optional(),
  label: z.string().trim().min(1).max(60),
  itemCount: z.number().int().min(1).max(500),
  total: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/),
  payload: z.record(z.string(), z.unknown()),
});

export async function holdCart(ctx: Ctx, input: unknown) {
  authorize(ctx, "pos.use");
  const r = holdSchema.safeParse(input);
  if (!r.success) throw validationFailed(zodFieldErrors(r.error));
  const size = JSON.stringify(r.data.payload).length;
  if (size > 100_000) throw validationFailed({ payload: ["Cart is too large to hold"] });
  return db.heldOrder.create({
    data: {
      branchId: ctx.branchId,
      terminalId: r.data.terminalId ?? null,
      label: r.data.label,
      itemCount: r.data.itemCount,
      total: r.data.total,
      payload: r.data.payload as object,
      createdById: ctx.user.id,
    },
  });
}

export async function listHeld(ctx: Ctx) {
  authorize(ctx, "pos.use");
  const rows = await db.heldOrder.findMany({ where: { branchId: ctx.branchId }, orderBy: { createdAt: "desc" }, take: 100 });
  const users = await db.user.findMany({
    where: { id: { in: rows.map((r) => r.createdById).filter(Boolean) as string[] } },
    select: { id: true, name: true },
  });
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    itemCount: r.itemCount,
    total: r.total.toFixed(2),
    createdAt: r.createdAt,
    createdBy: users.find((u) => u.id === r.createdById)?.name ?? null,
  }));
}

/** Take a held cart back (returns its payload and removes it). */
export async function takeHeld(ctx: Ctx, id: string) {
  authorize(ctx, "pos.use");
  return withTransaction(async (tx) => {
    const row = await tx.heldOrder.findFirst({ where: { id, branchId: ctx.branchId } });
    if (!row) throw notFound("Held order");
    await tx.heldOrder.delete({ where: { id } });
    return row.payload as Record<string, unknown>;
  });
}

export async function discardHeld(ctx: Ctx, id: string) {
  authorize(ctx, "pos.use");
  await db.heldOrder.deleteMany({ where: { id, branchId: ctx.branchId } });
}
