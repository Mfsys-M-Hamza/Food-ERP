import "server-only";
import { z } from "zod";
import { db, withTransaction } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";
import { authorize, authorizeAny } from "@/server/core/rbac";
import { recordAudit } from "@/server/core/audit";
import { invalidState, notFound, validationFailed } from "@/server/core/errors";
import { zodFieldErrors } from "@/server/core/action";
import { isPermissionKey, type PermissionKey } from "@/lib/rbac/catalog";

export type RoleRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  userCount: number;
  permissions: PermissionKey[];
};

/** Roles with their permissions. Needed by the role editor and the user form. */
export async function listRoles(ctx: Ctx): Promise<RoleRow[]> {
  authorizeAny(ctx, ["roles.manage", "users.manage"]);
  const roles = await db.role.findMany({
    orderBy: [{ isSystem: "desc" }, { createdAt: "asc" }],
    include: {
      permissions: { select: { permission: { select: { key: true } } } },
      _count: { select: { userRoles: true } },
    },
  });
  return roles.map((r) => ({
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    userCount: r._count.userRoles,
    permissions: r.permissions.map((p) => p.permission.key).filter(isPermissionKey),
  }));
}

const permissionsInput = z.array(z.string()).refine((keys) => keys.every(isPermissionKey), "Unknown permission");

export const createRoleSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(40),
  description: z.string().trim().max(200).optional().default(""),
  permissions: permissionsInput.default([]),
});

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "role";
}

export async function createRole(ctx: Ctx, input: unknown): Promise<RoleRow> {
  authorize(ctx, "roles.manage");
  const r = createRoleSchema.safeParse(input);
  if (!r.success) throw validationFailed(zodFieldErrors(r.error));
  const data = r.data;

  return withTransaction(async (tx) => {
    let key = slugify(data.name);
    if (await tx.role.findUnique({ where: { key } })) key = `${key}_${Date.now().toString(36)}`;
    const perms = await tx.permission.findMany({ where: { key: { in: data.permissions } }, select: { id: true } });
    const role = await tx.role.create({
      data: {
        key,
        name: data.name,
        description: data.description || null,
        isSystem: false,
        permissions: { create: perms.map((p) => ({ permissionId: p.id })) },
      },
    });
    await recordAudit(tx, ctx, {
      action: "role.create",
      module: "users",
      entityType: "role",
      entityId: role.id,
      after: { key, name: data.name, permissions: data.permissions },
    });
    return {
      id: role.id, key, name: role.name, description: role.description, isSystem: false, userCount: 0,
      permissions: data.permissions as PermissionKey[],
    };
  });
}

/** Replace a role's permission set. The Owner role cannot be edited (it always has everything). */
export async function updateRolePermissions(ctx: Ctx, roleId: string, input: unknown): Promise<void> {
  authorize(ctx, "roles.manage");
  const r = permissionsInput.safeParse(input);
  if (!r.success) throw validationFailed(zodFieldErrors(r.error));
  const next: string[] = [...new Set(r.data)].sort();

  await withTransaction(async (tx) => {
    const role = await tx.role.findUnique({
      where: { id: roleId },
      include: { permissions: { select: { permission: { select: { key: true } } } } },
    });
    if (!role) throw notFound("Role");
    if (role.key === "owner") throw invalidState("The Owner role always has every permission and cannot be edited.");

    const before = role.permissions.map((p) => p.permission.key).sort();
    const perms = await tx.permission.findMany({ where: { key: { in: next } }, select: { id: true } });
    await tx.rolePermission.deleteMany({ where: { roleId } });
    await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId, permissionId: p.id })) });

    const added = next.filter((k) => !before.includes(k));
    const removed = before.filter((k) => !next.includes(k));
    if (added.length || removed.length) {
      await recordAudit(tx, ctx, {
        action: "role.permissions.update",
        module: "users",
        entityType: "role",
        entityId: roleId,
        before: { permissions: removed },
        after: { permissions: added },
        reason: `${role.name}: +${added.length} / -${removed.length}`,
      });
    }
  });
}

export async function deleteRole(ctx: Ctx, roleId: string): Promise<void> {
  authorize(ctx, "roles.manage");
  await withTransaction(async (tx) => {
    const role = await tx.role.findUnique({ where: { id: roleId }, include: { _count: { select: { userRoles: true } } } });
    if (!role) throw notFound("Role");
    if (role.isSystem) throw invalidState("System roles cannot be deleted.");
    if (role._count.userRoles > 0) throw invalidState("Remove this role from all users before deleting it.");
    await tx.role.delete({ where: { id: roleId } });
    await recordAudit(tx, ctx, {
      action: "role.delete",
      module: "users",
      entityType: "role",
      entityId: roleId,
      before: { key: role.key, name: role.name },
    });
  });
}
