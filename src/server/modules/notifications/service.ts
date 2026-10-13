import "server-only";
import { db, Prisma, type Db } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";
import { authorize } from "@/server/core/rbac";
import type { PermissionKey } from "@/lib/rbac/catalog";
import { getSetting } from "@/server/modules/settings/service";
import { channelConfigured, sendMessage } from "./channels";

export type NotifyInput = {
  /** Everyone holding this permission (owners always included). */
  permission: PermissionKey;
  type: string;
  title: string;
  body?: string;
  link?: string;
  severity?: "INFO" | "WARNING" | "CRITICAL";
  /** Same key + same user = sent once. */
  dedupeKey?: string;
  branchId?: string | null;
};

/** Active staff who hold a permission (directly through a role) or are owners. */
export async function usersWith(client: Db, permission: PermissionKey) {
  return client.user.findMany({
    where: {
      kind: "STAFF",
      status: "ACTIVE",
      userRoles: { some: { role: { OR: [{ key: "owner" }, { permissions: { some: { permission: { key: permission } } } }] } } },
    },
    select: { id: true, email: true, name: true },
  });
}

/**
 * Create in-app notifications. Critical ones are also sent by e-mail / SMS /
 * WhatsApp according to the "Alerts & messages" settings.
 */
export async function notify(n: NotifyInput) {
  const users = await usersWith(db, n.permission);
  if (!users.length) return 0;
  const created = await db.notification.createMany({
    data: users.map((u) => ({
      userId: u.id,
      branchId: n.branchId ?? null,
      type: n.type,
      severity: n.severity ?? "INFO",
      title: n.title,
      body: n.body ?? null,
      link: n.link ?? null,
      dedupeKey: n.dedupeKey ?? null,
    })),
    skipDuplicates: true,
  });
  if (created.count > 0 && n.severity === "CRITICAL") await escalate(n, users);
  return created.count;
}

async function escalate(n: NotifyInput, users: { email: string }[]) {
  const s = await getSetting("notifications");
  const text = `${n.title}${n.body ? `\n${n.body}` : ""}`;
  if (s.emailCriticalAlerts && channelConfigured("EMAIL")) {
    const to = s.alertEmail ? [s.alertEmail] : users.map((u) => u.email).filter((e) => e && !e.endsWith(".local"));
    for (const email of [...new Set(to)]) await sendMessage({ channel: "EMAIL", to: email, subject: n.title, body: text, relatedType: n.type });
  }
  if (s.alertChannel !== "NONE" && s.alertPhone) {
    await sendMessage({ channel: s.alertChannel, to: s.alertPhone.replace(/[^\d+]/g, ""), body: text, relatedType: n.type });
  }
}

// ═══ Staff inbox ═════════════════════════════════════════════════════════════

export async function myNotifications(ctx: Ctx, opts: { limit?: number; unreadOnly?: boolean } = {}) {
  authorize(ctx, "notifications.view");
  const [rows, unread] = await Promise.all([
    db.notification.findMany({
      where: { userId: ctx.user.id, ...(opts.unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: "desc" },
      take: Math.min(opts.limit ?? 20, 200),
    }),
    db.notification.count({ where: { userId: ctx.user.id, readAt: null } }),
  ]);
  return {
    unread,
    items: rows.map((r) => ({ id: r.id, type: r.type, severity: r.severity, title: r.title, body: r.body, link: r.link, read: !!r.readAt, createdAt: r.createdAt.toISOString() })),
  };
}

export async function markRead(ctx: Ctx, id: string | "all") {
  authorize(ctx, "notifications.view");
  const where: Prisma.NotificationWhereInput = { userId: ctx.user.id, readAt: null, ...(id === "all" ? {} : { id }) };
  const r = await db.notification.updateMany({ where, data: { readAt: new Date() } });
  return { updated: r.count };
}
