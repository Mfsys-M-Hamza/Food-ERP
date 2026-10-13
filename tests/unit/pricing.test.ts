import { describe, expect, it } from "vitest";
import { priceOrder, taxRateFor, changeDue, deliveryChargeFor } from "@/lib/orders/pricing";
import { normalizePhone, formatPhone } from "@/lib/phone";
import { businessDate, compactDate } from "@/lib/business-date";
import { canTransition, nextStatuses } from "@/server/modules/orders/state-machine";

const lines = [
  { unitPrice: "590", addonsUnitTotal: "80", quantity: 2 }, // 1340
  { unitPrice: "250", addonsUnitTotal: "0", quantity: 1 }, // 250
];

describe("priceOrder", () => {
  it("sums lines with add-ons", () => {
    const r = priceOrder({ lines });
    expect(r.lineTotals).toEqual(["1340.00", "250.00"]);
    expect(r.subtotal).toBe("1590.00");
    expect(r.grandTotal).toBe("1590.00");
  });

  it("applies percent and fixed discounts, capping fixed at the subtotal", () => {
    expect(priceOrder({ lines, discount: { type: "PERCENT", value: "10" } })).toMatchObject({ discount: "159.00", grandTotal: "1431.00", discountPercent: 10 });
    expect(priceOrder({ lines, discount: { type: "AMOUNT", value: "5000" } })).toMatchObject({ discount: "1590.00", grandTotal: "0.00" });
  });

  it("adds exclusive tax after discount and service charge, but not on delivery", () => {
    const r = priceOrder({
      lines,
      discount: { type: "AMOUNT", value: "90" }, // 1500
      serviceChargePercent: 10, // 150 → base 1650
      deliveryCharge: "150",
      tax: { enabled: true, rate: 16, inclusive: false }, // 264
    });
    expect(r).toMatchObject({ serviceCharge: "150.00", taxableBase: "1650.00", tax: "264.00", grandTotal: "2064.00" });
  });

  it("extracts inclusive tax without changing the total", () => {
    const r = priceOrder({ lines: [{ unitPrice: "1160", addonsUnitTotal: "0", quantity: 1 }], tax: { enabled: true, rate: 16, inclusive: true } });
    expect(r).toMatchObject({ tax: "160.00", grandTotal: "1160.00" });
  });

  it("rounds cash totals and records the adjustment", () => {
    const r = priceOrder({ lines: [{ unitPrice: "247", addonsUnitTotal: "0", quantity: 1 }], cashRoundingStep: 5 });
    expect(r).toMatchObject({ grandTotal: "245.00", rounding: "-2.00" });
  });

  it("picks the tax rate by payment method", () => {
    const f = { taxEnabled: true, taxRateCash: 16, taxRateCard: 5 };
    expect(taxRateFor(["CASH"], f)).toBe(16);
    expect(taxRateFor(["CARD"], f)).toBe(5);
    expect(taxRateFor(["CARD", "CASH"], f)).toBe(16);
    expect(taxRateFor(["CARD"], { ...f, taxEnabled: false })).toBe(0);
  });

  it("computes change and delivery charge", () => {
    expect(changeDue("1431", "2000")).toBe("569.00");
    expect(changeDue("1431", "1000")).toBe("0.00");
    expect(deliveryChargeFor("900", { charge: "150", freeAbove: "1000" }, { defaultCharge: "200", freeDeliveryAbove: "" })).toBe("150.00");
    expect(deliveryChargeFor("1200", { charge: "150", freeAbove: "1000" }, { defaultCharge: "200", freeDeliveryAbove: "" })).toBe("0.00");
    expect(deliveryChargeFor("1200", null, { defaultCharge: "200", freeDeliveryAbove: "" })).toBe("200.00");
  });
});

describe("phone numbers", () => {
  it("normalises Pakistani formats", () => {
    for (const v of ["0300-1234567", "03001234567", "3001234567", "+92 300 1234567", "0092 300 1234567", "923001234567"]) {
      expect(normalizePhone(v)).toBe("+923001234567");
    }
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(formatPhone("+923001234567")).toBe("+92 300 1234567");
  });
});

describe("business date", () => {
  it("counts sales before the cut-off as the previous day", () => {
    // 02:00 Karachi on 13 Oct = 21:00 UTC on 12 Oct
    expect(businessDate(new Date("2026-10-12T21:00:00Z"), "Asia/Karachi", 5)).toBe("2026-10-12");
    // 06:00 Karachi on 13 Oct
    expect(businessDate(new Date("2026-10-13T01:00:00Z"), "Asia/Karachi", 5)).toBe("2026-10-13");
    expect(compactDate("2026-10-12")).toBe("261012");
  });
});

describe("order status machine", () => {
  it("allows the normal kitchen flow and blocks skipping", () => {
    expect(canTransition("NEW", "ACCEPTED", "TAKEAWAY")).toBe(true);
    expect(canTransition("ACCEPTED", "PREPARING", "TAKEAWAY")).toBe(true);
    expect(canTransition("NEW", "COMPLETED", "TAKEAWAY")).toBe(false);
    expect(canTransition("COMPLETED", "CANCELLED", "TAKEAWAY")).toBe(false);
  });
  it("routes delivery orders through out-for-delivery", () => {
    expect(canTransition("READY", "OUT_FOR_DELIVERY", "TAKEAWAY")).toBe(false);
    expect(canTransition("READY", "COMPLETED", "DELIVERY")).toBe(false);
    expect(nextStatuses("READY", "DELIVERY")).toEqual(["OUT_FOR_DELIVERY"]);
    expect(nextStatuses("READY", "TAKEAWAY")).toEqual(["COMPLETED"]);
  });
});
