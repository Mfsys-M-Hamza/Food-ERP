import "server-only";
import { z } from "zod";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";
import { authorize } from "@/server/core/rbac";
import { recordAudit } from "@/server/core/audit";
import { withTransaction } from "@/server/core/db";
import { validationFailed } from "@/server/core/errors";
import { getDefaultBranchId } from "@/server/core/branch";
import { getSetting, getBusinessHours } from "@/server/modules/settings/service";
import { getCatalog, type Catalog } from "@/server/modules/menu/catalog";
import { listZones } from "@/server/modules/delivery/zones";
import { isOpenAt, nextOpening } from "@/lib/store-hours";

/** Public menu, cached until the menu changes (tag "menu") or for a few minutes. */
export async function getPublicCatalog(): Promise<Catalog> {
  "use cache";
  cacheTag("menu");
  cacheLife("minutes");
  return getCatalog("ONLINE");
}

/** Public business info, cached until settings change. */
export async function getPublicProfile() {
  "use cache";
  cacheTag("settings");
  cacheLife("hours");
  const branchId = await getDefaultBranchId();
  const [profile, hours, delivery, ordering, finance] = await Promise.all([
    getSetting("business.profile"),
    getBusinessHours(branchId),
    getSetting("delivery"),
    getSetting("ordering"),
    getSetting("finance"),
  ]);
  const zones = await listZones(branchId, { activeOnly: true });
  return {
    profile,
    hours,
    zones,
    delivery: { defaultCharge: delivery.defaultCharge, minimumOrder: delivery.minimumOrder, freeDeliveryAbove: delivery.freeDeliveryAbove, estimatedMinutes: delivery.estimatedMinutes },
    ordering: { takeawayEnabled: ordering.takeawayEnabled, deliveryEnabled: ordering.deliveryEnabled, defaultPrepMinutes: ordering.defaultPrepMinutes },
    currencySymbol: finance.currencySymbol,
    tax: { enabled: finance.taxEnabled, label: finance.taxLabel, rateCash: finance.taxRateCash, inclusive: finance.pricesIncludeTax },
  };
}
export type PublicProfile = Awaited<ReturnType<typeof getPublicProfile>>;

export type StoreStatus = {
  open: boolean;
  accepting: boolean;
  message: string | null;
  nextOpening: string | null;
};

/** Live status (not cached): opening hours, online switch and temporary pause. */
export async function getStoreStatus(now = new Date()): Promise<StoreStatus> {
  const branchId = await getDefaultBranchId();
  const [branch, hours, ordering, exceptions] = await Promise.all([
    db.branch.findUniqueOrThrow({ where: { id: branchId }, select: { timezone: true } }),
    getBusinessHours(branchId),
    getSetting("ordering"),
    db.businessHourException.findMany({ where: { branchId } }),
  ]);
  const open = isOpenAt(
    now,
    branch.timezone,
    hours,
    exceptions.map((e) => ({ date: e.date.toISOString().slice(0, 10), isClosed: e.isClosed, opensAt: e.opensAt, closesAt: e.closesAt })),
  );
  const pausedUntil = ordering.onlinePausedUntil ? new Date(ordering.onlinePausedUntil) : null;
  const paused = !!pausedUntil && pausedUntil > now;
  let message: string | null = null;
  if (!ordering.onlineOrderingEnabled) message = "Online ordering is currently unavailable. Please call us to order.";
  else if (!open) message = "We are closed right now.";
  else if (paused) message = "We are very busy and have paused online orders for a short while. Please try again soon.";
  return {
    open,
    accepting: ordering.onlineOrderingEnabled && open && !paused,
    message,
    nextOpening: open ? null : nextOpening(now, branch.timezone, hours),
  };
}

/** POS control: pause online orders for N minutes (0 = resume). */
export async function setOnlinePause(ctx: Ctx, minutes: number) {
  authorize(ctx, "orders.accept");
  const m = z.number().int().min(0).max(240).safeParse(minutes);
  if (!m.success) throw validationFailed({ minutes: ["Choose 0–240 minutes"] });
  const until = m.data ? new Date(Date.now() + m.data * 60_000).toISOString() : "";
  await withTransaction(async (tx) => {
    const ordering = await getSetting("ordering", tx);
    const row = await tx.setting.findFirst({ where: { key: "ordering", branchId: null } });
    const value = { ...ordering, onlinePausedUntil: until };
    if (row) await tx.setting.update({ where: { id: row.id }, data: { value, updatedBy: ctx.user.id } });
    else await tx.setting.create({ data: { key: "ordering", branchId: null, value, updatedBy: ctx.user.id } });
    await recordAudit(tx, ctx, { action: m.data ? "online.pause" : "online.resume", module: "orders", after: { until } });
  });
  return { pausedUntil: until };
}
