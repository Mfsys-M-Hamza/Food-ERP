/**
 * Attendance arithmetic. Pure functions (no I/O), shared by the server and
 * the attendance screens, and unit tested.
 *
 * Times are "HH:MM" in the branch's local time. A work day is a business
 * date: a shift that starts at 16:00 and ends at 02:00 belongs to the day it
 * started.
 */

export type ShiftTimes = { startMinute: number; endMinute: number; graceMinutes: number; breakMinutes: number };

export const ATTENDANCE_STATUSES = ["PRESENT", "LATE", "HALF_DAY", "ABSENT", "PAID_LEAVE", "UNPAID_LEAVE", "OFF"] as const;
export type AttendanceStatusKey = (typeof ATTENDANCE_STATUSES)[number];

export const ATTENDANCE_LABEL: Record<AttendanceStatusKey, string> = {
  PRESENT: "Present",
  LATE: "Late",
  HALF_DAY: "Half day",
  ABSENT: "Absent",
  PAID_LEAVE: "Paid leave",
  UNPAID_LEAVE: "Unpaid leave",
  OFF: "Day off",
};

/** Statuses for which check-in / check-out times make sense. */
export const WORKED_STATUSES: AttendanceStatusKey[] = ["PRESENT", "LATE", "HALF_DAY"];

export function parseHm(value: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function formatHm(minute: number): string {
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Length of a shift in minutes; an end before the start means it runs past midnight. */
export function shiftLength(s: Pick<ShiftTimes, "startMinute" | "endMinute">): number {
  const len = (s.endMinute - s.startMinute + 1440) % 1440;
  return len === 0 ? 1440 : len;
}

/** Offset of a time zone from UTC at an instant, in minutes (Karachi = +300). */
export function zoneOffsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** The instant for "minute of day" on a local date ("2026-10-12", 960 → 16:00 Karachi). */
export function localInstant(isoDate: string, minuteOfDay: number, timeZone: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, 0, minuteOfDay);
  const offset = zoneOffsetMinutes(timeZone, new Date(guess));
  return new Date(guess - offset * 60_000);
}

/** Local minute of day for an instant. */
export function localMinute(at: Date, timeZone: string): number {
  const shifted = new Date(at.getTime() + zoneOffsetMinutes(timeZone, at) * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/**
 * Check-in / check-out times typed on the attendance sheet → instants.
 * A check-out earlier than the check-in is the next calendar day, and times
 * before the day cut-off (e.g. 01:30 with a 5 am cut-off) are too.
 */
export function timesToInstants(
  isoDate: string,
  checkIn: string,
  checkOut: string,
  timeZone: string,
  cutoffHour: number,
): { checkInAt: Date | null; checkOutAt: Date | null } {
  const inMin = checkIn ? parseHm(checkIn) : null;
  const outMin = checkOut ? parseHm(checkOut) : null;
  const nextDay = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const cutoff = cutoffHour * 60;
  const inDate = inMin !== null && inMin < cutoff ? nextDay(isoDate) : isoDate;
  const checkInAt = inMin === null ? null : localInstant(inDate, inMin, timeZone);
  let checkOutAt: Date | null = null;
  if (outMin !== null) {
    let outDate = outMin < cutoff ? nextDay(isoDate) : isoDate;
    let candidate = localInstant(outDate, outMin, timeZone);
    if (checkInAt && candidate <= checkInAt) {
      outDate = nextDay(outDate);
      candidate = localInstant(outDate, outMin, timeZone);
    }
    checkOutAt = candidate;
  }
  return { checkInAt, checkOutAt };
}

export type AttendanceCalc = { lateMinutes: number; workedMinutes: number; overtimeMinutes: number; isLate: boolean };

/**
 * Late, worked and overtime minutes for one day.
 * - Late counts from the shift start once the grace period is exceeded.
 * - Worked time excludes the shift's break.
 * - Overtime is worked time beyond the scheduled hours, counted only when it
 *   reaches the minimum (short overruns are ignored).
 */
export function calcAttendance(input: {
  workDate: string;
  checkInAt: Date | null;
  checkOutAt: Date | null;
  shift: ShiftTimes | null;
  timeZone: string;
  standardShiftHours: number;
  overtimeMinimumMinutes: number;
}): AttendanceCalc {
  const { checkInAt, checkOutAt, shift } = input;
  let lateMinutes = 0;
  if (checkInAt && shift) {
    const start = localInstant(input.workDate, shift.startMinute, input.timeZone);
    const late = Math.floor((checkInAt.getTime() - start.getTime()) / 60_000);
    if (late > shift.graceMinutes) lateMinutes = late;
  }
  let workedMinutes = 0;
  if (checkInAt && checkOutAt && checkOutAt > checkInAt) {
    const raw = Math.floor((checkOutAt.getTime() - checkInAt.getTime()) / 60_000);
    const brk = shift?.breakMinutes ?? 0;
    workedMinutes = raw > brk * 2 ? raw - brk : raw;
  }
  const scheduled = shift ? shiftLength(shift) - shift.breakMinutes : input.standardShiftHours * 60;
  const extra = workedMinutes - scheduled;
  const overtimeMinutes = extra >= Math.max(1, input.overtimeMinimumMinutes) ? extra : 0;
  return { lateMinutes, workedMinutes, overtimeMinutes, isLate: lateMinutes > 0 };
}

/** "2h 05m" style. */
export function formatMinutes(total: number): string {
  if (!total) return "0m";
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/** Every ISO date from start to end inclusive. */
export function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** Day of week (0 = Sunday) for an ISO date. */
export function weekday(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}
