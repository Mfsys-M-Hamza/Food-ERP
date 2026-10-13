import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/core/db";
import { createRole, deleteRole, listRoles, updateRolePermissions } from "@/server/modules/rbac/service";
import { listAuditLogs } from "@/server/modules/audit/service";
import { buildContext } from "@/server/core/context";
import { authorize, can } from "@/server/core/rbac";
import { recordAudit } from "@/server/core/audit";
import { createUserWithRole, ctxFor, ctxForRole, resetDatabase } from "./helpers";

beforeEach(async () => {
  await resetDatabase();
});

describe("roles and permissions", () => {
  it("seeds the five system roles with the approved defaults", async () => {
    const owner = await ctxForRole("owner");
    const roles = await listRoles(owner);
    expect(roles.map((r) => r.key).sort()).toEqual(["cashier", "kitchen", "manager", "owner", "rider"]);
    const kitchen = roles.find((r) => r.key === "kitchen")!;
    expect(kitchen.permissions).toContain("kitchen.update");
    expect(kitchen.permissions).not.toContain("pos.use");
  });

  it("applies permission changes on the next request and audits them", async () => {
    const owner = await ctxForRole("owner");
    const cashierUser = await createUserWithRole("cashier");
    expect(can(await ctxFor(cashierUser.id), "orders.refund")).toBe(false);

    const role = await db.role.findUniqueOrThrow({ where: { key: "cashier" }, include: { permissions: { include: { permission: true } } } });
    const keys = role.permissions.map((p) => p.permission.key);
    await updateRolePermissions(owner, role.id, [...keys, "orders.refund"]);

    expect(can(await ctxFor(cashierUser.id), "orders.refund")).toBe(true);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "role.permissions.update" } });
    expect(audit.after).toEqual({ permissions: ["orders.refund"] });
  });

  it("refuses to edit the owner role, unknown permissions, or delete system roles", async () => {
    const owner = await ctxForRole("owner");
    const ownerRole = await db.role.findUniqueOrThrow({ where: { key: "owner" } });
    await expect(updateRolePermissions(owner, ownerRole.id, [])).rejects.toMatchObject({ code: "INVALID_STATE" });

    const cashierRole = await db.role.findUniqueOrThrow({ where: { key: "cashier" } });
    await expect(updateRolePermissions(owner, cashierRole.id, ["root.everything"])).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(deleteRole(owner, cashierRole.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("creates and deletes custom roles", async () => {
    const owner = await ctxForRole("owner");
    const role = await createRole(owner, { name: "Shift Supervisor", permissions: ["pos.use", "orders.refund"] });
    expect(role.key).toBe("shift_supervisor");
    await deleteRole(owner, role.id);
    expect(await db.role.findUnique({ where: { id: role.id } })).toBeNull();
  });

  it("only the owner (by default) can manage roles", async () => {
    const manager = await ctxForRole("manager");
    await expect(createRole(manager, { name: "X role" })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(() => authorize(manager, "roles.manage")).toThrow();
  });

  it("returns no context for customers' missing roles or unknown users", async () => {
    expect(await buildContext("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

describe("audit log", () => {
  it("is append-only at the database level", async () => {
    const owner = await ctxForRole("owner");
    await recordAudit(db, owner, { action: "test.entry", module: "test", after: { a: 1 } });
    const row = await db.auditLog.findFirstOrThrow({ where: { action: "test.entry" } });

    await expect(db.auditLog.update({ where: { id: row.id }, data: { action: "tampered" } })).rejects.toThrow(/append-only/);
    await expect(db.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
    expect((await db.auditLog.findUniqueOrThrow({ where: { id: row.id } })).action).toBe("test.entry");
  });

  it("redacts secrets", async () => {
    const owner = await ctxForRole("owner");
    await recordAudit(db, owner, { action: "test.secret", module: "test", after: { password: "x", pinHash: "y", name: "ok" } });
    const row = await db.auditLog.findFirstOrThrow({ where: { action: "test.secret" } });
    expect(row.after).toEqual({ password: "[REDACTED]", pinHash: "[REDACTED]", name: "ok" });
  });

  it("is visible to the owner only and paginates newest first", async () => {
    const owner = await ctxForRole("owner");
    for (let i = 0; i < 5; i++) await recordAudit(db, owner, { action: `test.${i}`, module: "test" });
    const page1 = await listAuditLogs(owner, { module: "test", limit: 3 });
    expect(page1.rows.map((r) => r.action)).toEqual(["test.4", "test.3", "test.2"]);
    const page2 = await listAuditLogs(owner, { module: "test", limit: 3, cursor: page1.nextCursor! });
    expect(page2.rows.map((r) => r.action)).toEqual(["test.1", "test.0"]);
    expect(page2.nextCursor).toBeNull();

    const manager = await ctxForRole("manager");
    await expect(listAuditLogs(manager, {})).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
});

describe("database lockdown", () => {
  it("has row level security enabled on every public table", async () => {
    const rows = await db.$queryRaw<{ relname: string; relrowsecurity: boolean }[]>`
      SELECT c.relname, c.relrowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'`;
    const missing = rows.filter((r) => !r.relrowsecurity).map((r) => r.relname);
    expect(missing).toEqual([]);
  });

  it("enforces case-insensitive unique e-mails in the database", async () => {
    await createUserWithRole("cashier", { email: "dup@test.local" });
    await expect(createUserWithRole("cashier", { email: "DUP@test.local" })).rejects.toThrow();
  });

  it("allows only one global value per settings key", async () => {
    await expect(db.setting.create({ data: { key: "pos", branchId: null, value: {} } })).rejects.toThrow();
  });
});
