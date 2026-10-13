import "server-only";
import type { Ctx } from "./context";
import { forbidden } from "./errors";
import type { PermissionKey } from "@/lib/rbac/catalog";

/** True when the context holds the permission. Owners hold every permission. */
export function can(ctx: Ctx, permission: PermissionKey): boolean {
  return ctx.isOwner || ctx.permissions.has(permission);
}

export function canAny(ctx: Ctx, permissions: PermissionKey[]): boolean {
  return permissions.some((p) => can(ctx, p));
}

/** Throws PERMISSION_DENIED unless the context holds the permission. Call at the top of every service function. */
export function authorize(ctx: Ctx, permission: PermissionKey): void {
  if (!can(ctx, permission)) throw forbidden();
}

export function authorizeAny(ctx: Ctx, permissions: PermissionKey[]): void {
  if (!canAny(ctx, permissions)) throw forbidden();
}

/** Only the Owner role may perform this action. */
export function authorizeOwner(ctx: Ctx): void {
  if (!ctx.isOwner) throw forbidden("Only the Owner can do this.");
}
