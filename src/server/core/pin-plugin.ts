import "server-only";
import { z } from "zod";
import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint, getSessionFromCtx, APIError } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { db } from "./db";
import { verifySecret } from "./password";

/**
 * POS quick switch: on a device that already has a staff session, another
 * staff member signs in with their 4–6 digit PIN. The previous session on the
 * device is ended. Five wrong PINs lock that user's PIN for five minutes.
 */
export const pinSwitchPlugin = () =>
  ({
    id: "pin-switch",
    endpoints: {
      pinSwitch: createAuthEndpoint(
        "/pin/switch",
        {
          method: "POST",
          body: z.object({ userId: z.string().uuid(), pin: z.string().regex(/^\d{4,6}$/) }),
        },
        async (ctx) => {
          const current = await getSessionFromCtx(ctx);
          if (!current) throw new APIError("UNAUTHORIZED", { message: "This device is not signed in." });
          const currentUser = await db.user.findUnique({ where: { id: current.user.id }, select: { kind: true } });
          if (currentUser?.kind !== "STAFF") throw new APIError("FORBIDDEN", { message: "Staff device required." });

          const target = await db.user.findUnique({ where: { id: ctx.body.userId } });
          if (!target || target.kind !== "STAFF" || target.status !== "ACTIVE" || !target.pinHash) {
            throw new APIError("UNAUTHORIZED", { message: "Incorrect PIN." });
          }
          if (target.pinLockedUntil && target.pinLockedUntil > new Date()) {
            throw new APIError("TOO_MANY_REQUESTS", { message: "PIN locked for a few minutes after too many attempts." });
          }
          if (!(await verifySecret(target.pinHash, ctx.body.pin))) {
            const failed = target.pinFailedCount + 1;
            await db.user.update({
              where: { id: target.id },
              data: failed >= 5 ? { pinFailedCount: 0, pinLockedUntil: new Date(Date.now() + 5 * 60_000) } : { pinFailedCount: failed },
            });
            await db.auditLog.create({
              data: { userId: current.user.id, action: "auth.pin_failed", module: "auth", entityType: "user", entityId: target.id },
            });
            throw new APIError("UNAUTHORIZED", { message: "Incorrect PIN." });
          }
          await db.user.update({ where: { id: target.id }, data: { pinFailedCount: 0, pinLockedUntil: null } });

          const session = await ctx.context.internalAdapter.createSession(target.id);
          if (!session) throw new APIError("INTERNAL_SERVER_ERROR", { message: "Could not start a session." });
          await ctx.context.internalAdapter.deleteSession(current.session.token);
          const user = await ctx.context.internalAdapter.findUserById(target.id);
          await setSessionCookie(ctx, { session, user: user! });
          await db.auditLog.create({
            data: {
              userId: target.id,
              action: "auth.pin_switch",
              module: "auth",
              entityType: "user",
              entityId: target.id,
              before: { previousUserId: current.user.id },
            },
          });
          return ctx.json({ ok: true, user: { id: target.id, name: target.name } });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;
