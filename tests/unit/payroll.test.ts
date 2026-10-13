import { describe, expect, it } from "vitest";
import { calcPayslip, type PayrollSettings } from "@/lib/payroll";
import { calcAttendance, localInstant, localMinute, timesToInstants, shiftLength, formatMinutes, eachDay } from "@/lib/attendance";

const TZ = "Asia/Karachi";
const settings: PayrollSettings = { dailyRateBasis: "30", unrecordedDays: "PAID", latesPerDayDeduction: 0, overtimeMultiplier: "1", standardShiftHours: 8 };
const base = {
  payType: "MONTHLY" as const,
  baseRate: "30000",
  overtimeRate: null,
  periodStart: "2026-09-01",
  periodEnd: "2026-09-30",
  joiningDate: "2025-01-01",
  leavingDate: null,
  weeklyOffDays: [1],
  shiftHours: 10,
  attendance: [],
  advances: [],
  manualLines: [],
  settings,
};
const line = (r: ReturnType<typeof calcPayslip>, code: string) => r.lines.find((l) => l.code === code)?.amount;

describe("attendance arithmetic", () => {
  it("converts local times and handles shifts past midnight", () => {
    expect(localInstant("2026-10-12", 16 * 60, TZ).toISOString()).toBe("2026-10-12T11:00:00.000Z");
    expect(localMinute(new Date("2026-10-12T11:00:00Z"), TZ)).toBe(960);
    expect(shiftLength({ startMinute: 16 * 60, endMinute: 2 * 60 })).toBe(600);
    const { checkInAt, checkOutAt } = timesToInstants("2026-10-12", "16:05", "02:10", TZ, 5);
    expect(checkInAt!.toISOString()).toBe("2026-10-12T11:05:00.000Z");
    expect(checkOutAt!.toISOString()).toBe("2026-10-12T21:10:00.000Z"); // 02:10 on the 13th, local
  });

  it("counts late only beyond the grace period, worked time without the break, overtime above the minimum", () => {
    const shift = { startMinute: 16 * 60, endMinute: 2 * 60, graceMinutes: 10, breakMinutes: 30 };
    const day = (inT: string, outT: string) => {
      const t = timesToInstants("2026-10-12", inT, outT, TZ, 5);
      return calcAttendance({ workDate: "2026-10-12", ...t, shift, timeZone: TZ, standardShiftHours: 8, overtimeMinimumMinutes: 30 });
    };
    expect(day("16:08", "").lateMinutes).toBe(0);
    expect(day("16:25", "").lateMinutes).toBe(25);
    expect(day("16:25", "").isLate).toBe(true);
    const full = day("16:00", "02:00");
    expect(full.workedMinutes).toBe(570);
    expect(full.overtimeMinutes).toBe(0);
    expect(day("16:00", "02:20").overtimeMinutes).toBe(0); // 20 min over: below the 30-minute minimum
    expect(day("16:00", "03:00").overtimeMinutes).toBe(60);
    expect(formatMinutes(570)).toBe("9h 30m");
    expect(eachDay("2026-02-27", "2026-03-02")).toHaveLength(4);
  });
});

describe("payslip calculation", () => {
  it("pays a full month and deducts absences at salary ÷ 30", () => {
    const r = calcPayslip({ ...base, attendance: [{ date: "2026-09-03", status: "ABSENT", workedMinutes: 0, overtimeMinutes: 0 }, { date: "2026-09-04", status: "HALF_DAY", workedMinutes: 300, overtimeMinutes: 0 }] });
    expect(line(r, "BASIC")).toBe("30000.00");
    expect(line(r, "ABSENCE")).toBe("1000.00");
    expect(line(r, "HALF_DAY")).toBe("500.00");
    expect(r.net).toBe("28500.00");
    expect(r.offDays).toBe(4); // Mondays in September 2026
    expect(r.unrecordedDays).toBe(24);
    expect(r.warnings.join(" ")).toMatch(/no attendance entry/);
  });

  it("deducts unrecorded days when the setting says so, and a day per N late arrivals", () => {
    const att = ["2026-09-02", "2026-09-03", "2026-09-04"].map((date) => ({ date, status: "LATE" as const, workedMinutes: 600, overtimeMinutes: 0 }));
    const r = calcPayslip({ ...base, attendance: att, settings: { ...settings, unrecordedDays: "UNPAID", latesPerDayDeduction: 3 } });
    expect(line(r, "UNRECORDED")).toBe(String((30 - 4 - 3) * 1000) + ".00");
    expect(line(r, "LATE")).toBe("1000.00");
  });

  it("pro-rates someone who joined mid-month", () => {
    const r = calcPayslip({ ...base, joiningDate: "2026-09-16" });
    expect(r.employedDays).toBe(15);
    expect(line(r, "BASIC")).toBe("15000.00");
  });

  it("pays overtime at the derived hourly rate × multiplier, or a fixed overtime rate", () => {
    const att = [{ date: "2026-09-02", status: "PRESENT" as const, workedMinutes: 720, overtimeMinutes: 120 }];
    const r = calcPayslip({ ...base, attendance: att, settings: { ...settings, overtimeMultiplier: "1.5" } });
    // 30000 / 30 = 1000 a day; / 10 hours = 100 an hour; × 1.5 × 2 h
    expect(line(r, "OVERTIME")).toBe("300.00");
    const fixed = calcPayslip({ ...base, overtimeRate: "250", attendance: att });
    expect(line(fixed, "OVERTIME")).toBe("500.00");
  });

  it("pays daily wages for recorded days only, and hourly staff for hours", () => {
    const att = [
      { date: "2026-09-02", status: "PRESENT" as const, workedMinutes: 480, overtimeMinutes: 0 },
      { date: "2026-09-03", status: "HALF_DAY" as const, workedMinutes: 240, overtimeMinutes: 0 },
      { date: "2026-09-04", status: "PAID_LEAVE" as const, workedMinutes: 0, overtimeMinutes: 0 },
    ];
    expect(calcPayslip({ ...base, payType: "DAILY", baseRate: "1500", attendance: att }).net).toBe("3750.00");
    const hourly = calcPayslip({ ...base, payType: "HOURLY", baseRate: "200", shiftHours: 8, attendance: att });
    expect(line(hourly, "BASIC")).toBe("2400.00"); // 12 h × 200
    expect(line(hourly, "PAID_LEAVE")).toBe("1600.00");
  });

  it("recovers advances oldest first by installment and never below zero, with manual lines", () => {
    const r = calcPayslip({
      ...base,
      baseRate: "20000",
      advances: [
        { id: "b", balance: "50000", installment: null, issuedOn: "2026-09-10" },
        { id: "a", balance: "6000", installment: "5000", issuedOn: "2026-08-01" },
      ],
      manualLines: [{ kind: "EARNING", code: "BONUS", label: "Eid bonus", amount: "2000" }],
    });
    const adv = r.lines.filter((l) => l.code === "ADVANCE");
    expect(adv.map((l) => [l.advanceId, l.amount])).toEqual([
      ["a", "5000.00"],
      ["b", "17000.00"],
    ]);
    expect(r.gross).toBe("22000.00");
    expect(r.net).toBe("0.00");
    expect(r.warnings.join(" ")).toMatch(/partly recovered/);
  });
});
