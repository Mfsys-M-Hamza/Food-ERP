import Decimal from "decimal.js";
import { eachDay, weekday, type AttendanceStatusKey } from "./attendance";

/**
 * Payslip calculation. Pure (no I/O) so every rule is unit tested.
 *
 * Monthly salary: the basic is the full salary (or pro-rated by days employed
 * when someone joins or leaves mid-period). Absences, unpaid leave and half
 * days are deducted at the daily rate; optionally every N late arrivals cost
 * one day. Days with no entry follow the "unrecorded days" setting.
 *
 * Daily wage: paid for recorded working days and paid leave only.
 * Hourly: paid for worked hours (overtime hours paid separately).
 *
 * Advances are recovered last and never push the net below zero.
 */

export type PayType = "MONTHLY" | "DAILY" | "HOURLY";

export type PayrollSettings = {
  dailyRateBasis: "CALENDAR" | "30" | "26";
  unrecordedDays: "PAID" | "UNPAID";
  latesPerDayDeduction: number;
  overtimeMultiplier: string;
  standardShiftHours: number;
};

export type DayRecord = { date: string; status: AttendanceStatusKey; workedMinutes: number; overtimeMinutes: number };
export type AdvanceBalance = { id: string; balance: string; installment: string | null; issuedOn: string };
export type ManualLine = { kind: "EARNING" | "DEDUCTION"; code: string; label: string; amount: string };

export type PayslipLineCalc = {
  kind: "EARNING" | "DEDUCTION";
  code: string;
  label: string;
  amount: string;
  isManual: boolean;
  advanceId?: string;
};

export type PayslipCalc = {
  periodDays: number;
  employedDays: number;
  payableDays: string;
  presentDays: string;
  absentDays: string;
  leaveDays: string;
  offDays: number;
  unrecordedDays: number;
  lateCount: number;
  workedMinutes: number;
  overtimeMinutes: number;
  dailyRate: string;
  hourlyRate: string;
  lines: PayslipLineCalc[];
  gross: string;
  deductions: string;
  net: string;
  warnings: string[];
};

const r2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function calcPayslip(input: {
  payType: PayType;
  baseRate: string;
  overtimeRate: string | null;
  periodStart: string;
  periodEnd: string;
  joiningDate: string;
  leavingDate: string | null;
  weeklyOffDays: number[];
  /** Scheduled hours per day (from the work shift or the standard). */
  shiftHours: number;
  attendance: DayRecord[];
  advances: AdvanceBalance[];
  manualLines: ManualLine[];
  settings: PayrollSettings;
}): PayslipCalc {
  const s = input.settings;
  const days = eachDay(input.periodStart, input.periodEnd);
  const periodDays = days.length;
  const byDate = new Map(input.attendance.map((a) => [a.date, a]));
  const base = new Decimal(input.baseRate || 0);
  const warnings: string[] = [];

  let employedDays = 0;
  let present = 0;
  let absent = 0;
  let paidLeave = 0;
  let unpaidLeave = 0;
  let half = 0;
  let off = 0;
  let unrecorded = 0;
  let lateCount = 0;
  let workedMinutes = 0;
  let overtimeMinutes = 0;

  for (const day of days) {
    if (day < input.joiningDate || (input.leavingDate && day > input.leavingDate)) continue;
    employedDays++;
    const rec = byDate.get(day);
    if (!rec) {
      if (input.weeklyOffDays.includes(weekday(day))) off++;
      else unrecorded++;
      continue;
    }
    workedMinutes += rec.workedMinutes;
    overtimeMinutes += rec.overtimeMinutes;
    switch (rec.status) {
      case "PRESENT":
        present++;
        break;
      case "LATE":
        present++;
        lateCount++;
        break;
      case "HALF_DAY":
        half++;
        break;
      case "ABSENT":
        absent++;
        break;
      case "PAID_LEAVE":
        paidLeave++;
        break;
      case "UNPAID_LEAVE":
        unpaidLeave++;
        break;
      case "OFF":
        off++;
        break;
    }
  }

  // Rates
  const monthDivisor = s.dailyRateBasis === "CALENDAR" ? periodDays : Number(s.dailyRateBasis);
  const dailyRate =
    input.payType === "MONTHLY" ? base.div(monthDivisor) : input.payType === "DAILY" ? base : base.times(input.shiftHours);
  const hourlyRate = input.payType === "HOURLY" ? base : dailyRate.div(input.shiftHours);
  const multiplier = new Decimal(s.overtimeMultiplier || 1);
  const overtimeHourly = input.overtimeRate ? new Decimal(input.overtimeRate) : hourlyRate.times(multiplier);

  const lines: PayslipLineCalc[] = [];
  const earn = (code: string, label: string, amount: Decimal) => {
    if (amount.greaterThan(0)) lines.push({ kind: "EARNING", code, label, amount: r2(amount).toFixed(2), isManual: false });
  };
  const deduct = (code: string, label: string, amount: Decimal) => {
    if (amount.greaterThan(0)) lines.push({ kind: "DEDUCTION", code, label, amount: r2(amount).toFixed(2), isManual: false });
  };

  const unpaidUnrecorded = s.unrecordedDays === "UNPAID" ? unrecorded : 0;
  let payableDays: number;

  if (input.payType === "MONTHLY") {
    const full = employedDays === periodDays;
    const basic = full ? base : Decimal.min(base, dailyRate.times(employedDays));
    earn("BASIC", full ? "Basic salary" : `Basic salary (${employedDays} of ${periodDays} days)`, basic);
    const deductedDays = absent + unpaidLeave + half * 0.5 + unpaidUnrecorded;
    payableDays = employedDays - deductedDays;
    if (absent) deduct("ABSENCE", `Absent ${fmtDays(absent)} day${absent === 1 ? "" : "s"}`, dailyRate.times(absent));
    if (unpaidLeave) deduct("UNPAID_LEAVE", `Unpaid leave ${fmtDays(unpaidLeave)} day${unpaidLeave === 1 ? "" : "s"}`, dailyRate.times(unpaidLeave));
    if (half) deduct("HALF_DAY", `Half days ${half} × ½`, dailyRate.times(half * 0.5));
    if (unpaidUnrecorded) deduct("UNRECORDED", `No attendance entry ${unpaidUnrecorded} day${unpaidUnrecorded === 1 ? "" : "s"}`, dailyRate.times(unpaidUnrecorded));
  } else if (input.payType === "DAILY") {
    payableDays = present + paidLeave + half * 0.5;
    earn("BASIC", `Wages ${fmtDays(payableDays)} day${payableDays === 1 ? "" : "s"} × ${r2(base).toFixed(0)}`, base.times(payableDays));
  } else {
    const regularMinutes = Math.max(0, workedMinutes - overtimeMinutes);
    payableDays = present + half * 0.5 + paidLeave;
    earn("BASIC", `${(regularMinutes / 60).toFixed(1)} hours × ${r2(base).toFixed(0)}`, base.times(regularMinutes).div(60));
    if (paidLeave) earn("PAID_LEAVE", `Paid leave ${paidLeave} day${paidLeave === 1 ? "" : "s"}`, dailyRate.times(paidLeave));
  }

  if (s.latesPerDayDeduction > 0 && lateCount >= s.latesPerDayDeduction) {
    const lateDays = Math.floor(lateCount / s.latesPerDayDeduction);
    deduct("LATE", `${lateCount} late arrivals (${lateDays} day${lateDays === 1 ? "" : "s"})`, dailyRate.times(lateDays));
  }
  if (overtimeMinutes > 0) {
    earn("OVERTIME", `Overtime ${(overtimeMinutes / 60).toFixed(1)} hours`, overtimeHourly.times(overtimeMinutes).div(60));
  }

  for (const m of input.manualLines) {
    lines.push({ kind: m.kind, code: m.code, label: m.label, amount: r2(new Decimal(m.amount)).toFixed(2), isManual: true });
  }

  const total = (kind: "EARNING" | "DEDUCTION") => lines.filter((l) => l.kind === kind).reduce((a, l) => a.plus(l.amount), new Decimal(0));
  let gross = total("EARNING");
  let deductions = total("DEDUCTION");
  if (deductions.greaterThan(gross)) warnings.push("Deductions are more than the earnings; the net pay is set to zero.");

  // Advances: oldest first, capped by what is left to pay.
  let room = Decimal.max(0, gross.minus(deductions));
  for (const a of [...input.advances].sort((x, y) => x.issuedOn.localeCompare(y.issuedOn))) {
    const bal = new Decimal(a.balance);
    if (bal.lessThanOrEqualTo(0)) continue;
    let take = Decimal.min(bal, a.installment ? new Decimal(a.installment) : bal, room);
    take = r2(take);
    if (take.lessThan(Decimal.min(bal, a.installment ? new Decimal(a.installment) : bal))) {
      warnings.push(`Advance of ${a.issuedOn} is only partly recovered because the pay is too low.`);
    }
    if (take.lessThanOrEqualTo(0)) continue;
    lines.push({ kind: "DEDUCTION", code: "ADVANCE", label: `Advance recovery (${a.issuedOn})`, amount: take.toFixed(2), isManual: false, advanceId: a.id });
    room = room.minus(take);
  }

  gross = total("EARNING");
  deductions = total("DEDUCTION");
  const net = Decimal.max(0, gross.minus(deductions));
  if (unrecorded > 0 && s.unrecordedDays === "PAID" && input.payType === "MONTHLY") {
    warnings.push(`${unrecorded} working day${unrecorded === 1 ? " has" : "s have"} no attendance entry and ${unrecorded === 1 ? "is" : "are"} paid.`);
  }

  return {
    periodDays,
    employedDays,
    payableDays: Math.max(0, payableDays).toFixed(2),
    presentDays: (present + half * 0.5).toFixed(2),
    absentDays: (absent + half * 0.5).toFixed(2),
    leaveDays: (paidLeave + unpaidLeave).toFixed(2),
    offDays: off,
    unrecordedDays: unrecorded,
    lateCount,
    workedMinutes,
    overtimeMinutes,
    dailyRate: r2(dailyRate).toFixed(2),
    hourlyRate: r2(hourlyRate).toFixed(2),
    lines,
    gross: r2(gross).toFixed(2),
    deductions: r2(deductions).toFixed(2),
    net: r2(net).toFixed(2),
    warnings,
  };
}
