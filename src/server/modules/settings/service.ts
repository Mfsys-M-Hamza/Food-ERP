import "server-only";
import { z } from "zod";
import { db, withTransaction, type Db } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";
import { authorize } from "@/server/core/rbac";
import { recordAudit, diffObjects } from "@/server/core/audit";
import { validationFailed } from "@/server/core/errors";
import { zodFieldErrors } from "@/server/core/action";
import {
  settingsSchemas,
  parseStoredSettings,
  defaultSettings,
  SETTINGS_KEYS,
  type SettingsKey,
  type SettingsValue,
} from "@/lib/settings/registry";

/**
 * Read one settings key (global value; branch overrides arrive with multi-branch).
 * No permission check: used internally and by public pages for non-secret data.
 */
export async function getSetting<K extends SettingsKey>(key: K, client: Db = db): Promise<SettingsValue<K>> {
  const row = await client.setting.findFirst({ where: { key, branchId: null }, select: { value: true } });
  return row ? parseStoredSettings(key, row.value) : defaultSettings(key);
}

/** All settings, for the admin settings screens. */
export async function getAllSettings(ctx: Ctx): Promise<{ [K in SettingsKey]: SettingsValue<K> }> {
  authorize(ctx, "settings.view");
  const rows = await db.setting.findMany({ where: { branchId: null } });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out = {} as { [K in SettingsKey]: SettingsValue<K> };
  for (const key of SETTINGS_KEYS) {
    (out as Record<string, unknown>)[key] = byKey.has(key)
      ? parseStoredSettings(key, byKey.get(key))
      : defaultSettings(key);
  }
  return out;
}

/** Validate and save a settings key. Writes an audit entry with the changed fields. */
export async function updateSetting<K extends SettingsKey>(ctx: Ctx, key: K, input: unknown): Promise<SettingsValue<K>> {
  authorize(ctx, "settings.manage");
  const schema = settingsSchemas[key] as unknown as z.ZodType<SettingsValue<K>>;
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw validationFailed(zodFieldErrors(parsed.error));
  const value = parsed.data;

  return withTransaction(async (tx) => {
    const existing = await tx.setting.findFirst({ where: { key, branchId: null } });
    const before = existing ? parseStoredSettings(key, existing.value) : defaultSettings(key);
    if (existing) {
      await tx.setting.update({ where: { id: existing.id }, data: { value: value as object, updatedBy: ctx.user.id } });
    } else {
      await tx.setting.create({ data: { key, branchId: null, value: value as object, updatedBy: ctx.user.id } });
    }
    const diff = diffObjects(before as Record<string, unknown>, value as Record<string, unknown>);
    if (Object.keys(diff.after).length > 0) {
      await recordAudit(tx, ctx, {
        action: "settings.update",
        module: "settings",
        entityType: "setting",
        entityId: key,
        before: diff.before,
        after: diff.after,
      });
    }
    return value;
  });
}

// ─── Opening hours ──────────────────────────────────────────────────────────

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm (24-hour)");

export const businessHoursSchema = z
  .array(
    z.object({
      weekday: z.number().int().min(0).max(6),
      isClosed: z.boolean(),
      opensAt: time,
      closesAt: time,
    }),
  )
  .length(7)
  .refine((rows) => new Set(rows.map((r) => r.weekday)).size === 7, "Each weekday must appear once");

export type BusinessHoursInput = z.infer<typeof businessHoursSchema>;

export async function getBusinessHours(branchId: string, client: Db = db): Promise<BusinessHoursInput> {
  const rows = await client.businessHour.findMany({ where: { branchId }, orderBy: { weekday: "asc" } });
  return Array.from({ length: 7 }, (_, weekday) => {
    const r = rows.find((x) => x.weekday === weekday);
    return r
      ? { weekday, isClosed: r.isClosed, opensAt: r.opensAt, closesAt: r.closesAt }
      : { weekday, isClosed: false, opensAt: "11:00", closesAt: "23:00" };
  });
}

export async function updateBusinessHours(ctx: Ctx, input: unknown): Promise<BusinessHoursInput> {
  authorize(ctx, "settings.manage");
  const parsed = businessHoursSchema.safeParse(input);
  if (!parsed.success) throw validationFailed(zodFieldErrors(parsed.error));

  return withTransaction(async (tx) => {
    const before = await getBusinessHours(ctx.branchId, tx);
    for (const row of parsed.data) {
      await tx.businessHour.upsert({
        where: { branchId_weekday: { branchId: ctx.branchId, weekday: row.weekday } },
        create: { branchId: ctx.branchId, ...row },
        update: { isClosed: row.isClosed, opensAt: row.opensAt, closesAt: row.closesAt },
      });
    }
    await recordAudit(tx, ctx, {
      action: "settings.hours.update",
      module: "settings",
      entityType: "business_hours",
      entityId: ctx.branchId,
      before,
      after: parsed.data,
    });
    return parsed.data;
  });
}
