import { describe, expect, it } from "vitest";
import {
  SETTINGS_KEYS,
  SETTINGS_SECTIONS,
  defaultSettings,
  parseStoredSettings,
  settingsSchemas,
} from "@/lib/settings/registry";

describe("settings registry", () => {
  it("has valid defaults for every key", () => {
    for (const key of SETTINGS_KEYS) {
      expect(() => settingsSchemas[key].parse(defaultSettings(key))).not.toThrow();
    }
  });

  it("uses the approved defaults", () => {
    expect(defaultSettings("inventory")).toEqual({ deductionPoint: "PREPARING", allowNegativeStock: true });
    expect(defaultSettings("ordering").dineInEnabled).toBe(false);
    expect(defaultSettings("finance").taxEnabled).toBe(false);
    expect(defaultSettings("loyalty").enabled).toBe(false);
  });

  it("rejects invalid money, percentages and e-mails", () => {
    const delivery = defaultSettings("delivery");
    expect(settingsSchemas.delivery.safeParse({ ...delivery, defaultCharge: "12.345" }).success).toBe(false);
    expect(settingsSchemas.delivery.safeParse({ ...delivery, defaultCharge: "-5" }).success).toBe(false);
    expect(settingsSchemas.pos.safeParse({ ...defaultSettings("pos"), cashierMaxDiscountPercent: 150 }).success).toBe(false);
    const profile = defaultSettings("business.profile");
    expect(settingsSchemas["business.profile"].safeParse({ ...profile, email: "not-an-email" }).success).toBe(false);
  });

  it("coerces numeric strings from forms", () => {
    const parsed = settingsSchemas.finance.parse({ ...defaultSettings("finance"), taxRateCash: "16", cashRoundingStep: "5" });
    expect(parsed.taxRateCash).toBe(16);
    expect(parsed.cashRoundingStep).toBe(5);
  });

  it("fills missing stored fields with defaults and survives corrupt data", () => {
    expect(parseStoredSettings("pos", { autoPrintReceipt: false })).toMatchObject({
      autoPrintReceipt: false,
      cashierMaxDiscountPercent: 10,
    });
    expect(parseStoredSettings("pos", { cashierMaxDiscountPercent: "abc" })).toEqual(defaultSettings("pos"));
  });

  it("describes only fields that exist in the schema", () => {
    for (const section of SETTINGS_SECTIONS) {
      const shape = Object.keys(settingsSchemas[section.key].shape);
      for (const f of section.fields) expect(shape).toContain(f.name);
    }
  });
});
