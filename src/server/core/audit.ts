import "server-only";
import type { Ctx } from "./context";
import type { Db } from "./db";
import { Prisma } from "./db";

const REDACTED_KEYS = new Set(["password", "pinHash", "pin", "token", "secret", "passwordHash", "nationalId"]);

/** Remove secrets and convert values (Decimal, Date, BigInt) to JSON-safe forms. */
export function sanitizeForAudit(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined || value === null) return Prisma.JsonNull;
  const json = JSON.stringify(value, (key, v) => {
    if (REDACTED_KEYS.has(key)) return "[REDACTED]";
    if (typeof v === "bigint") return v.toString();
    return v;
  });
  return JSON.parse(json) as Prisma.InputJsonValue;
}

export type AuditEntry = {
  action: string;
  module: string;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  overrideUserId?: string;
};

/**
 * Record an audit entry. Pass the transaction client so the audit row commits
 * (or rolls back) together with the change it describes.
 */
export async function recordAudit(tx: Db, ctx: Ctx | null, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      branchId: ctx?.branchId ?? null,
      userId: ctx?.user.id || null, // empty id = guest (online checkout)
      overrideUserId: entry.overrideUserId ?? null,
      action: entry.action,
      module: entry.module,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      before: sanitizeForAudit(entry.before),
      after: sanitizeForAudit(entry.after),
      reason: entry.reason ?? null,
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent?.slice(0, 300) ?? null,
      terminalId: ctx?.terminalId ?? null,
    },
  });
}

/** Return only the keys whose values changed, for compact before/after records. */
export function diffObjects<T extends Record<string, unknown>>(before: T, after: T): { before: Partial<T>; after: Partial<T> } {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      b[key as keyof T] = before[key] as T[keyof T];
      a[key as keyof T] = after[key] as T[keyof T];
    }
  }
  return { before: b, after: a };
}
