import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/core/db";
import { AppError } from "@/server/core/errors";
import {
  getAllSettings,
  getBusinessHours,
  getSetting,
  updateBusinessHours,
  updateSetting,
} from "@/server/modules/settings/service";
import { ctxForRole, resetDatabase } from "./helpers";

beforeEach(async () => {
  await resetDatabase();
});

describe("settings service", () => {
  it("lets the owner update settings and records only changed fields in the audit log", async () => {
    const owner = await ctxForRole("owner");
    const current = await getSetting("pos");
    await updateSetting(owner, "pos", { ...current, cashierMaxDiscountPercent: 15 });

    expect((await getSetting("pos")).cashierMaxDiscountPercent).toBe(15);
    const audit = await db.auditLog.findMany({ where: { action: "settings.update", entityId: "pos" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.userId).toBe(owner.user.id);
    expect(audit[0]!.before).toEqual({ cashierMaxDiscountPercent: 10 });
    expect(audit[0]!.after).toEqual({ cashierMaxDiscountPercent: 15 });
  });

  it("does not write an audit entry when nothing changed", async () => {
    const owner = await ctxForRole("owner");
    await updateSetting(owner, "receipt", await getSetting("receipt"));
    expect(await db.auditLog.count({ where: { action: "settings.update" } })).toBe(0);
  });

  it("rejects invalid values with field errors", async () => {
    const owner = await ctxForRole("owner");
    const current = await getSetting("delivery");
    const err = await updateSetting(owner, "delivery", { ...current, defaultCharge: "abc" }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(err.fieldErrors.defaultCharge).toBeDefined();
  });

  it("lets managers view but not change settings", async () => {
    const manager = await ctxForRole("manager");
    await expect(getAllSettings(manager)).resolves.toHaveProperty("business.profile");
    const err = await updateSetting(manager, "pos", await getSetting("pos")).catch((e) => e);
    expect(err.code).toBe("PERMISSION_DENIED");
  });

  it("blocks cashiers, kitchen staff and riders from settings entirely", async () => {
    for (const role of ["cashier", "kitchen", "rider"]) {
      const ctx = await ctxForRole(role);
      await expect(getAllSettings(ctx)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    }
  });

  it("saves opening hours including past-midnight closing", async () => {
    const owner = await ctxForRole("owner");
    const hours = await getBusinessHours(owner.branchId);
    hours[5] = { weekday: 5, isClosed: false, opensAt: "12:00", closesAt: "02:00" };
    hours[0] = { weekday: 0, isClosed: true, opensAt: "11:00", closesAt: "23:00" };
    await updateBusinessHours(owner, hours);

    const saved = await getBusinessHours(owner.branchId);
    expect(saved[5]).toMatchObject({ opensAt: "12:00", closesAt: "02:00" });
    expect(saved[0]!.isClosed).toBe(true);
    expect(await db.auditLog.count({ where: { action: "settings.hours.update" } })).toBe(1);
  });

  it("rejects malformed opening hours", async () => {
    const owner = await ctxForRole("owner");
    const hours = await getBusinessHours(owner.branchId);
    hours[1] = { ...hours[1]!, opensAt: "25:00" };
    await expect(updateBusinessHours(owner, hours)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(updateBusinessHours(owner, hours.slice(0, 6))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});
