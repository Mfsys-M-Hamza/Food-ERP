import "server-only";
import { db } from "./db";
import type { Ctx } from "./context";
import { buildContext } from "./context";
import { can } from "./rbac";
import { forbidden, validationFailed } from "./errors";
import { consumeThrottle, resetThrottle } from "./throttle";
import { verifySecret } from "./password";
import type { PermissionKey } from "@/lib/rbac/catalog";

/**
 * Manager override: a manager/owner types their PIN on the cashier's screen to
 * approve one action. Returns the approving user's id (stored in audit logs).
 * Staff PINs are unique, so the PIN identifies the approver.
 * Attempts are throttled per signed-in user: 5 per 5 minutes.
 */
export async function verifyOverridePin(ctx: Ctx, pin: string | null | undefined, permission: PermissionKey): Promise<string> {
  if (!pin || !/^\d{4,6}$/.test(pin)) throw validationFailed({ overridePin: ["Enter a manager PIN (4–6 digits)"] }, "Manager approval required.");
  const key = `pin-override:${ctx.user.id}`;
  await consumeThrottle(key, 5, 300);

  const candidates = await db.user.findMany({
    where: { kind: "STAFF", status: "ACTIVE", pinHash: { not: null }, id: { not: ctx.user.id } },
    select: { id: true, pinHash: true },
  });
  for (const c of candidates) {
    if (await verifySecret(c.pinHash!, pin)) {
      const approver = await buildContext(c.id);
      if (approver && can(approver, permission)) {
        await resetThrottle(key);
        return c.id;
      }
      throw forbidden("That PIN belongs to someone who cannot approve this action.");
    }
  }
  throw forbidden("Incorrect manager PIN.");
}

/**
 * Authorise an action that cashiers may do only with a manager's approval:
 * returns null when the user holds the permission, otherwise the approver id.
 */
export async function authorizeOrOverride(
  ctx: Ctx,
  permission: PermissionKey,
  overridePin: string | null | undefined,
): Promise<string | null> {
  if (can(ctx, permission)) return null;
  return verifyOverridePin(ctx, overridePin, permission);
}
