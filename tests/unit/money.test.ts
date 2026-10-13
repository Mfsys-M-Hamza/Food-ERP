import { describe, expect, it } from "vitest";
import { formatMoney, money, percentOf, round2, roundCash, sum, toMoneyString } from "@/lib/money";

describe("money", () => {
  it("avoids floating point errors", () => {
    expect(sum(["0.1", "0.2"]).toString()).toBe("0.3");
    expect(money("19.99").times(3).toFixed(2)).toBe("59.97");
  });

  it("rounds half up to 2 decimals", () => {
    expect(round2("1.005").toFixed(2)).toBe("1.01");
    expect(round2("2.344").toFixed(2)).toBe("2.34");
  });

  it("calculates percentages", () => {
    expect(percentOf("1250", 16).toFixed(2)).toBe("200.00");
    expect(percentOf("999", "5").toFixed(2)).toBe("49.95");
  });

  it("rounds cash totals and reports the adjustment", () => {
    const down = roundCash("1247", 5);
    expect(down.total.toFixed(2)).toBe("1245.00");
    expect(down.adjustment.toFixed(2)).toBe("-2.00");
    const up = roundCash("1248", 10);
    expect(up.total.toFixed(2)).toBe("1250.00");
    expect(up.adjustment.toFixed(2)).toBe("2.00");
    expect(roundCash("1248.40", 0).adjustment.toFixed(2)).toBe("0.00");
  });

  it("formats for display and API", () => {
    expect(formatMoney("1250")).toBe("Rs 1,250");
    expect(formatMoney("1250.5")).toBe("Rs 1,250.50");
    expect(formatMoney("-75")).toBe("-Rs 75");
    expect(toMoneyString(12)).toBe("12.00");
  });

  it("treats empty values as zero", () => {
    expect(money(null).toNumber()).toBe(0);
    expect(money("").toNumber()).toBe(0);
  });
});
