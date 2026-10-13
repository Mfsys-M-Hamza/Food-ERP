import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { auth } from "./auth";
import { db } from "./db";
import { getDefaultBranchId } from "./branch";
import { unauthenticated } from "./errors";
import { isPermissionKey, type PermissionKey } from "@/lib/rbac/catalog";

/**
 * Request context passed to every service function. Built from the session on
 * the server; never accepted from the client.
 */
export type Ctx = {
  user: { id: string; name: string; email: string; kind: "STAFF" | "CUSTOMER" };
  roles: string[];
  permissions: ReadonlySet<PermissionKey>;
  isOwner: boolean;
  branchId: string;
  ip: string | null;
  userAgent: string | null;
  terminalId: string | null;
};

/** Loads roles and permissions for a user. Exported for tests and route handlers. */
export async function buildContext(
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null; terminalId?: string | null } = {},
): Promise<Ctx | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      kind: true,
      status: true,
      userRoles: {
        select: {
          role: { select: { key: true, permissions: { select: { permission: { select: { key: true } } } } } },
        },
      },
    },
  });
  if (!user || user.status !== "ACTIVE") return null;

  const roles = user.userRoles.map((ur) => ur.role.key);
  const permissions = new Set<PermissionKey>();
  for (const ur of user.userRoles) {
    for (const rp of ur.role.permissions) {
      if (isPermissionKey(rp.permission.key)) permissions.add(rp.permission.key);
    }
  }

  return {
    user: { id: user.id, name: user.name, email: user.email, kind: user.kind },
    roles,
    permissions,
    isOwner: roles.includes("owner"),
    branchId: await getDefaultBranchId(),
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
    terminalId: meta.terminalId ?? null,
  };
}

function clientIp(h: Headers): string | null {
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return h.get("x-real-ip");
}

/** Resolve the context from request headers (Route Handlers). */
export async function getContextFromHeaders(h: Headers): Promise<Ctx | null> {
  const session = await auth.api.getSession({ headers: h });
  if (!session) return null;
  return buildContext(session.user.id, {
    ip: clientIp(h),
    userAgent: h.get("user-agent"),
  });
}

/**
 * Current context for Server Components and Server Actions. Deduplicated per
 * request with React `cache`.
 */
export const getContext = cache(async (): Promise<Ctx | null> => {
  const h = await headers();
  return getContextFromHeaders(h);
});

/** Like getContext but throws UNAUTHENTICATED when there is no valid session. */
export async function requireContext(): Promise<Ctx> {
  const ctx = await getContext();
  if (!ctx) throw unauthenticated();
  return ctx;
}

/** Narrow, serialisable view of the context for client components. */
export function publicContext(ctx: Ctx) {
  return {
    user: { id: ctx.user.id, name: ctx.user.name, email: ctx.user.email },
    roles: ctx.roles,
    permissions: [...ctx.permissions],
    isOwner: ctx.isOwner,
  };
}
export type PublicContext = ReturnType<typeof publicContext>;
