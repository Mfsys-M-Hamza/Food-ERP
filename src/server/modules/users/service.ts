import "server-only";
import { db, withTransaction, type Tx } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";
import { authorize } from "@/server/core/rbac";
import { recordAudit, diffObjects } from "@/server/core/audit";
import { invalidState, notFound, validationFailed, forbidden } from "@/server/core/errors";
import { zodFieldErrors } from "@/server/core/action";
import { hashSecret, verifySecret } from "@/server/core/password";
import {
  createStaffSchema,
  updateStaffSchema,
  resetPasswordSchema,
  setPinSchema,
} from "./schemas";
import type { z } from "zod";

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw validationFailed(zodFieldErrors(r.error));
  return r.data;
}

const staffSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  pinHash: true,
  userRoles: { select: { role: { select: { key: true, name: true } } } },
} as const;

export type StaffUserRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: "ACTIVE" | "DISABLED";
  lastLoginAt: Date | null;
  createdAt: Date;
  hasPin: boolean;
  roles: { key: string; name: string }[];
};

function toRow(u: {
  id: string; name: string; email: string; phone: string | null; status: "ACTIVE" | "DISABLED";
  lastLoginAt: Date | null; createdAt: Date; pinHash: string | null;
  userRoles: { role: { key: string; name: string } }[];
}): StaffUserRow {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    status: u.status,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    hasPin: !!u.pinHash,
    roles: u.userRoles.map((ur) => ur.role),
  };
}

/** Staff PINs must be unique: a PIN alone identifies the approver for manager overrides. */
async function assertPinUnique(pin: string, excludeUserId?: string) {
  const others = await db.user.findMany({
    where: { pinHash: { not: null }, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) },
    select: { pinHash: true },
  });
  for (const o of others) {
    if (await verifySecret(o.pinHash!, pin)) throw validationFailed({ pin: ["This PIN is already used. Choose another one."] });
  }
}

export async function listStaff(ctx: Ctx, opts: { q?: string } = {}): Promise<StaffUserRow[]> {
  authorize(ctx, "users.manage");
  const q = opts.q?.trim();
  const users = await db.user.findMany({
    where: {
      kind: "STAFF",
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {}),
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: staffSelect,
    take: 500,
  });
  return users.map(toRow);
}

export async function getStaff(ctx: Ctx, id: string): Promise<StaffUserRow> {
  authorize(ctx, "users.manage");
  const u = await db.user.findFirst({ where: { id, kind: "STAFF" }, select: staffSelect });
  if (!u) throw notFound("User");
  return toRow(u);
}

async function resolveRoles(tx: Tx, ctx: Ctx, roleKeys: string[]) {
  const roles = await tx.role.findMany({ where: { key: { in: roleKeys } }, select: { id: true, key: true } });
  if (roles.length !== new Set(roleKeys).size) throw validationFailed({ roleKeys: ["Unknown role selected"] });
  if (roles.some((r) => r.key === "owner") && !ctx.isOwner) throw forbidden("Only the Owner can grant the Owner role.");
  return roles;
}

async function countActiveOwners(tx: Tx, excludeUserId?: string) {
  return tx.user.count({
    where: {
      status: "ACTIVE",
      kind: "STAFF",
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      userRoles: { some: { role: { key: "owner" } } },
    },
  });
}

export async function createStaff(ctx: Ctx, input: unknown): Promise<StaffUserRow> {
  authorize(ctx, "users.manage");
  const data = parse(createStaffSchema, input);
  const passwordHash = await hashSecret(data.password);
  if (data.pin) await assertPinUnique(data.pin);
  const pinHash = data.pin ? await hashSecret(data.pin) : null;

  return withTransaction(async (tx) => {
    const existing = await tx.user.findFirst({ where: { email: { equals: data.email, mode: "insensitive" } }, select: { id: true } });
    if (existing) throw validationFailed({ email: ["This e-mail is already used by another account"] });
    if (data.phone) {
      const phoneUsed = await tx.user.findUnique({ where: { phone: data.phone }, select: { id: true } });
      if (phoneUsed) throw validationFailed({ phone: ["This phone number is already used"] });
    }
    const roles = await resolveRoles(tx, ctx, data.roleKeys);

    const user = await tx.user.create({
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone || null,
        kind: "STAFF",
        status: "ACTIVE",
        emailVerified: true,
        pinHash,
        userRoles: { create: roles.map((r) => ({ roleId: r.id })) },
      },
      select: staffSelect,
    });
    await tx.account.create({
      data: { userId: user.id, accountId: user.id, providerId: "credential", password: passwordHash },
    });
    await recordAudit(tx, ctx, {
      action: "user.create",
      module: "users",
      entityType: "user",
      entityId: user.id,
      after: { name: user.name, email: user.email, phone: user.phone, roles: data.roleKeys, pinSet: !!pinHash },
    });
    return toRow(user);
  });
}

export async function updateStaff(ctx: Ctx, id: string, input: unknown): Promise<StaffUserRow> {
  authorize(ctx, "users.manage");
  const data = parse(updateStaffSchema, input);

  return withTransaction(async (tx) => {
    const current = await tx.user.findFirst({ where: { id, kind: "STAFF" }, select: staffSelect });
    if (!current) throw notFound("User");

    if (id === ctx.user.id && data.status === "DISABLED") throw invalidState("You cannot disable your own account.");

    const currentRoleKeys = current.userRoles.map((r) => r.role.key).sort();
    const nextRoleKeys = [...new Set(data.roleKeys)].sort();
    const wasOwner = currentRoleKeys.includes("owner");
    const willBeOwner = nextRoleKeys.includes("owner");
    if (wasOwner !== willBeOwner && !ctx.isOwner) throw forbidden("Only the Owner can change the Owner role.");
    if (wasOwner && (!willBeOwner || data.status === "DISABLED") && (await countActiveOwners(tx, id)) === 0) {
      throw invalidState("At least one active Owner account must remain.");
    }

    const emailOwner = await tx.user.findFirst({
      where: { email: { equals: data.email, mode: "insensitive" }, id: { not: id } },
      select: { id: true },
    });
    if (emailOwner) throw validationFailed({ email: ["This e-mail is already used by another account"] });
    if (data.phone) {
      const phoneOwner = await tx.user.findFirst({ where: { phone: data.phone, id: { not: id } }, select: { id: true } });
      if (phoneOwner) throw validationFailed({ phone: ["This phone number is already used"] });
    }

    const roles = await resolveRoles(tx, ctx, nextRoleKeys);
    await tx.user.update({
      where: { id },
      data: { name: data.name, email: data.email, phone: data.phone || null, status: data.status },
    });
    const rolesChanged = JSON.stringify(currentRoleKeys) !== JSON.stringify(nextRoleKeys);
    if (rolesChanged) {
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.userRole.createMany({ data: roles.map((r) => ({ userId: id, roleId: r.id })) });
    }
    // Disabled users and role changes end existing sessions immediately.
    if (data.status === "DISABLED" || rolesChanged) {
      await tx.session.deleteMany({ where: { userId: id } });
    }

    const before = { name: current.name, email: current.email, phone: current.phone, status: current.status, roles: currentRoleKeys };
    const after = { name: data.name, email: data.email, phone: data.phone || null, status: data.status, roles: nextRoleKeys };
    const diff = diffObjects(before, after);
    if (Object.keys(diff.after).length) {
      await recordAudit(tx, ctx, {
        action: rolesChanged ? "user.roles.update" : "user.update",
        module: "users",
        entityType: "user",
        entityId: id,
        before: diff.before,
        after: diff.after,
      });
    }
    const updated = await tx.user.findUniqueOrThrow({ where: { id }, select: staffSelect });
    return toRow(updated);
  });
}

export async function resetStaffPassword(ctx: Ctx, id: string, input: unknown): Promise<void> {
  authorize(ctx, "users.manage");
  const { password } = parse(resetPasswordSchema, input);
  const hash = await hashSecret(password);
  await withTransaction(async (tx) => {
    const user = await tx.user.findFirst({ where: { id, kind: "STAFF" }, select: { id: true } });
    if (!user) throw notFound("User");
    const account = await tx.account.findFirst({ where: { userId: id, providerId: "credential" }, select: { id: true } });
    if (account) {
      await tx.account.update({ where: { id: account.id }, data: { password: hash } });
    } else {
      await tx.account.create({ data: { userId: id, accountId: id, providerId: "credential", password: hash } });
    }
    if (id !== ctx.user.id) await tx.session.deleteMany({ where: { userId: id } });
    await recordAudit(tx, ctx, { action: "user.password.reset", module: "users", entityType: "user", entityId: id });
  });
}

export async function setStaffPin(ctx: Ctx, id: string, input: unknown): Promise<void> {
  authorize(ctx, "users.manage");
  const { pin } = parse(setPinSchema, input);
  await assertPinUnique(pin, id);
  const pinHash = await hashSecret(pin);
  await withTransaction(async (tx) => {
    const user = await tx.user.findFirst({ where: { id, kind: "STAFF" }, select: { id: true } });
    if (!user) throw notFound("User");
    await tx.user.update({ where: { id }, data: { pinHash, pinFailedCount: 0, pinLockedUntil: null } });
    await recordAudit(tx, ctx, { action: "user.pin.set", module: "users", entityType: "user", entityId: id });
  });
}

export async function clearStaffPin(ctx: Ctx, id: string): Promise<void> {
  authorize(ctx, "users.manage");
  await withTransaction(async (tx) => {
    const user = await tx.user.findFirst({ where: { id, kind: "STAFF" }, select: { id: true } });
    if (!user) throw notFound("User");
    await tx.user.update({ where: { id }, data: { pinHash: null, pinFailedCount: 0, pinLockedUntil: null } });
    await recordAudit(tx, ctx, { action: "user.pin.clear", module: "users", entityType: "user", entityId: id });
  });
}

