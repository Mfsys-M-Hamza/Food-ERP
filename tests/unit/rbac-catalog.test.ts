import { describe, expect, it } from "vitest";
import {
  PERMISSIONS,
  PERMISSION_KEYS,
  ROLE_KEYS,
  defaultPermissionsFor,
  isPermissionKey,
  permissionsByModule,
} from "@/lib/rbac/catalog";

describe("permission catalog", () => {
  it("gives the owner every permission", () => {
    expect(defaultPermissionsFor("owner").sort()).toEqual([...PERMISSION_KEYS].sort());
  });

  it("matches the approved role matrix for key rules", () => {
    const cashier = defaultPermissionsFor("cashier");
    expect(cashier).toContain("pos.use");
    expect(cashier).toContain("shifts.own");
    expect(cashier).not.toContain("orders.refund"); // needs manager override
    expect(cashier).not.toContain("settings.view");
    expect(cashier).not.toContain("dashboard.view");

    const kitchen = defaultPermissionsFor("kitchen");
    expect(kitchen).toContain("kitchen.update");
    expect(kitchen).not.toContain("pos.use");
    expect(kitchen).not.toContain("orders.view");

    const rider = defaultPermissionsFor("rider");
    expect(rider).toEqual(expect.arrayContaining(["delivery.rider", "attendance.self"]));
    expect(rider).not.toContain("customers.view");

    const manager = defaultPermissionsFor("manager");
    expect(manager).toContain("settings.view");
    expect(manager).not.toContain("settings.manage");
    expect(manager).not.toContain("users.manage");
    expect(manager).not.toContain("payroll.approve");
    expect(manager).not.toContain("audit.view");
  });

  it("only owners manage users, roles, settings and audit by default", () => {
    for (const key of ["users.manage", "roles.manage", "settings.manage", "audit.view"] as const) {
      expect(PERMISSIONS[key].roles).toEqual([]);
    }
  });

  it("uses only known role keys and a module for every permission", () => {
    for (const key of PERMISSION_KEYS) {
      expect(PERMISSIONS[key].module).toBeTruthy();
      for (const r of PERMISSIONS[key].roles) expect(ROLE_KEYS).toContain(r);
    }
  });

  it("groups all permissions by module", () => {
    const flattened = permissionsByModule().flatMap((g) => g.keys);
    expect(flattened.sort()).toEqual([...PERMISSION_KEYS].sort());
  });

  it("validates permission keys", () => {
    expect(isPermissionKey("pos.use")).toBe(true);
    expect(isPermissionKey("constructor")).toBe(false);
    expect(isPermissionKey("admin.everything")).toBe(false);
  });
});
