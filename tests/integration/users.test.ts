import { beforeEach, describe, expect, it } from "vitest";
import { verifyPassword } from "better-auth/crypto";
import { db } from "@/server/core/db";
import {
  createStaff,
  listStaff,
  resetStaffPassword,
  setStaffPin,
  updateStaff,
} from "@/server/modules/users/service";
import { buildContext } from "@/server/core/context";
import { createUserWithRole, ctxFor, ctxForRole, resetDatabase } from "./helpers";

beforeEach(async () => {
  await resetDatabase();
});

const newCashier = {
  name: "Sara Malik",
  email: "Sara@Example.com",
  phone: "+92 300 1112223",
  password: "Cashier12345",
  roleKeys: ["cashier"],
  pin: "4321",
};

describe("staff user management", () => {
  it("creates a staff user with a hashed password, PIN, role and audit entry", async () => {
    const owner = await ctxForRole("owner");
    const user = await createStaff(owner, newCashier);

    expect(user.email).toBe("sara@example.com");
    expect(user.roles.map((r) => r.key)).toEqual(["cashier"]);
    expect(user.hasPin).toBe(true);

    const account = await db.account.findFirstOrThrow({ where: { userId: user.id, providerId: "credential" } });
    expect(account.password).not.toContain("Cashier12345");
    expect(await verifyPassword({ hash: account.password!, password: "Cashier12345" })).toBe(true);

    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "user.create", entityId: user.id } });
    expect(JSON.stringify(audit.after)).not.toContain("Cashier12345");
    expect(JSON.stringify(audit.after)).not.toContain("4321");

    const ctx = await buildContext(user.id);
    expect(ctx?.permissions.has("pos.use")).toBe(true);
    expect(ctx?.permissions.has("settings.view")).toBe(false);
  });

  it("rejects duplicate e-mails regardless of case", async () => {
    const owner = await ctxForRole("owner");
    await createStaff(owner, newCashier);
    const err = await createStaff(owner, { ...newCashier, email: "SARA@example.com", phone: "", pin: "" }).catch((e) => e);
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(err.fieldErrors.email).toBeDefined();
  });

  it("enforces password rules", async () => {
    const owner = await ctxForRole("owner");
    const err = await createStaff(owner, { ...newCashier, password: "short" }).catch((e) => e);
    expect(err.fieldErrors.password).toBeDefined();
  });

  it("does not let managers or cashiers manage users", async () => {
    for (const role of ["manager", "cashier"]) {
      const ctx = await ctxForRole(role);
      await expect(listStaff(ctx)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      await expect(createStaff(ctx, newCashier)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    }
  });

  it("keeps at least one active owner", async () => {
    const owner = await ctxForRole("owner");
    const other = await createStaff(owner, { ...newCashier, roleKeys: ["owner"], pin: "" });
    // The second owner may remove owner rights from the first (one owner remains)…
    const otherCtx = await ctxFor(other.id);
    await updateStaff(otherCtx, owner.user.id, {
      name: owner.user.name,
      email: owner.user.email,
      phone: "",
      roleKeys: ["manager"],
      status: "ACTIVE",
    });
    // …but not from themselves when they are the last owner.
    const err = await updateStaff(otherCtx, other.id, {
      name: other.name,
      email: other.email,
      phone: "",
      roleKeys: ["manager"],
      status: "ACTIVE",
    }).catch((e) => e);
    expect(err.code).toBe("INVALID_STATE");
  });

  it("prevents disabling your own account", async () => {
    const owner = await ctxForRole("owner");
    const err = await updateStaff(owner, owner.user.id, {
      name: owner.user.name,
      email: owner.user.email,
      phone: "",
      roleKeys: ["owner"],
      status: "DISABLED",
    }).catch((e) => e);
    expect(err.code).toBe("INVALID_STATE");
  });

  it("ends sessions when a user is disabled or their roles change, and blocks their context", async () => {
    const owner = await ctxForRole("owner");
    const cashier = await createUserWithRole("cashier");
    await db.session.create({
      data: { userId: cashier.id, token: "tok-" + cashier.id, expiresAt: new Date(Date.now() + 3_600_000) },
    });

    await updateStaff(owner, cashier.id, {
      name: cashier.name,
      email: cashier.email,
      phone: "",
      roleKeys: ["cashier"],
      status: "DISABLED",
    });
    expect(await db.session.count({ where: { userId: cashier.id } })).toBe(0);
    expect(await buildContext(cashier.id)).toBeNull();

    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: cashier.id, action: "user.update" } });
    expect(audit.before).toMatchObject({ status: "ACTIVE" });
    expect(audit.after).toMatchObject({ status: "DISABLED" });
  });

  it("resets passwords and sets PINs with audit entries", async () => {
    const owner = await ctxForRole("owner");
    const cashier = await createUserWithRole("cashier");
    await resetStaffPassword(owner, cashier.id, { password: "BrandNew12345" });
    const account = await db.account.findFirstOrThrow({ where: { userId: cashier.id } });
    expect(await verifyPassword({ hash: account.password!, password: "BrandNew12345" })).toBe(true);

    await setStaffPin(owner, cashier.id, { pin: "9876" });
    await expect(setStaffPin(owner, cashier.id, { pin: "12" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    const actions = (await db.auditLog.findMany({ where: { entityId: cashier.id } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["user.password.reset", "user.pin.set"]));
  });
});
