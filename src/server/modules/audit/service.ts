import "server-only";
import { z } from "zod";
import { db } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";
import { authorize } from "@/server/core/rbac";

export const auditFilterSchema = z.object({
  module: z.string().trim().max(40).optional(),
  userId: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  cursor: z.coerce.bigint().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AuditFilter = z.input<typeof auditFilterSchema>;

export type AuditRow = {
  id: string;
  createdAt: Date;
  action: string;
  module: string;
  entityType: string | null;
  entityId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
  user: { id: string; name: string } | null;
};

/** Newest first, keyset pagination on id. */
export async function listAuditLogs(ctx: Ctx, input: AuditFilter): Promise<{ rows: AuditRow[]; nextCursor: string | null }> {
  authorize(ctx, "audit.view");
  const f = auditFilterSchema.parse(input);
  const createdAt: { gte?: Date; lt?: Date } = {};
  if (f.from) createdAt.gte = new Date(`${f.from}T00:00:00+05:00`);
  if (f.to) createdAt.lt = new Date(new Date(`${f.to}T00:00:00+05:00`).getTime() + 86_400_000);

  const rows = await db.auditLog.findMany({
    where: {
      ...(f.module ? { module: f.module } : {}),
      ...(f.userId ? { userId: f.userId } : {}),
      ...(f.q ? { OR: [{ action: { contains: f.q, mode: "insensitive" } }, { entityId: { contains: f.q } }, { reason: { contains: f.q, mode: "insensitive" } }] } : {}),
      ...(f.from || f.to ? { createdAt } : {}),
      ...(f.cursor ? { id: { lt: f.cursor } } : {}),
    },
    orderBy: { id: "desc" },
    take: f.limit + 1,
    include: { user: { select: { id: true, name: true } } },
  });
  const hasMore = rows.length > f.limit;
  const page = hasMore ? rows.slice(0, f.limit) : rows;
  return {
    rows: page.map((r) => ({
      id: r.id.toString(),
      createdAt: r.createdAt,
      action: r.action,
      module: r.module,
      entityType: r.entityType,
      entityId: r.entityId,
      before: r.before,
      after: r.after,
      reason: r.reason,
      ip: r.ip,
      userAgent: r.userAgent,
      user: r.user,
    })),
    nextCursor: hasMore ? page[page.length - 1]!.id.toString() : null,
  };
}

export async function listAuditModules(ctx: Ctx): Promise<string[]> {
  authorize(ctx, "audit.view");
  const rows = await db.auditLog.findMany({ distinct: ["module"], select: { module: true }, orderBy: { module: "asc" } });
  return rows.map((r) => r.module);
}
