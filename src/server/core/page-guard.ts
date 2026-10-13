import "server-only";
import { redirect } from "next/navigation";
import { getContext, type Ctx } from "./context";
import type { PermissionKey } from "@/lib/rbac/catalog";
import { can } from "./rbac";

/**
 * For staff pages: returns the context or redirects to the staff login.
 * Customer accounts are sent to the public site.
 */
export async function requireStaffPage(nextPath?: string): Promise<Ctx> {
  const ctx = await getContext();
  if (!ctx) redirect(`/staff/login${nextPath ? `?next=${encodeURIComponent(nextPath)}` : ""}`);
  if (ctx.user.kind !== "STAFF") redirect("/");
  return ctx;
}

/** Where a staff member lands after login, based on what they may use. */
export function staffHome(ctx: Ctx): string {
  const order: [PermissionKey, string][] = [
    ["dashboard.view", "/admin"],
    ["pos.use", "/pos"],
    ["kitchen.view", "/kitchen"],
    ["delivery.rider", "/rider"],
    ["settings.view", "/admin/settings"],
    ["users.manage", "/admin/users"],
    ["attendance.self", "/admin/clock"],
  ];
  for (const [perm, path] of order) if (can(ctx, perm)) return path;
  return "/staff/no-access";
}
