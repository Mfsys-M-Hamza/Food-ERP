import "server-only";
import { z } from "zod";
import { db, withTransaction, type Db } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";
import { authorize, authorizeAny } from "@/server/core/rbac";
import { recordAudit } from "@/server/core/audit";
import { conflict, invalidState, notFound, validationFailed } from "@/server/core/errors";
import { zodFieldErrors } from "@/server/core/action";
import { dayToDate, dateToDay, todayFor } from "@/server/core/today";
import { getSetting } from "@/server/modules/settings/service";
import {
  ATTENDANCE_STATUSES,
  WORKED_STATUSES,
  calcAttendance,
  eachDay,
  formatHm,
  localMinute,
  parseHm,
  timesToInstants,
  weekday,
  type AttendanceStatusKey,
} from "@/lib/attendance";
import { employeesOn } from "./employees";

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw validationFailed(zodFieldErrors(r.error));
  return r.data;
}

const hm = z.union([z.string().refine((v) => parseHm(v) !== null, "Use HH:MM"), z.literal("")]).default("");

export const attendanceSchema = z
  .object({
    employeeId: z.uuid(),
    workDate: z.iso.date(),
    status: z.enum(ATTENDANCE_STATUSES),
    checkIn: hm,
    checkOut: hm,
    note: z.string().trim().max(200).optional().default(""),
  })
  .superRefine((v, c) => {
    if (v.checkOut && !v.checkIn) c.addIssue({ code: "custom", path: ["checkIn"], message: "Enter the check-in time" });
  });

async function context(tx: Db, branchId: string) {
  const [branch, ordering, payroll] = [
    await tx.branch.findUniqueOrThrow({ where: { id: branchId }, select: { timezone: true } }),
    await getSetting("ordering", tx),
    await getSetting("payroll", tx),
  ];
  return { timeZone: branch.timezone, cutoffHour: ordering.dayCutoffHour, payroll };
}

type EmployeeWithShift = Awaited<ReturnType<typeof employeesOn>>[number];

function derive(
  e: Pick<EmployeeWithShift, "workShift">,
  workDate: string,
  status: AttendanceStatusKey,
  checkInAt: Date | null,
  checkOutAt: Date | null,
  c: Awaited<ReturnType<typeof context>>,
) {
  const worked = WORKED_STATUSES.includes(status);
  const calc = worked
    ? calcAttendance({
        workDate,
        checkInAt,
        checkOutAt,
        shift: e.workShift,
        timeZone: c.timeZone,
        standardShiftHours: c.payroll.standardShiftHours,
        overtimeMinimumMinutes: c.payroll.overtimeMinimumMinutes,
      })
    : { lateMinutes: 0, workedMinutes: 0, overtimeMinutes: 0, isLate: false };
  // A check-in past the grace period makes "present" a "late"; a manager may still mark late by hand.
  const finalStatus: AttendanceStatusKey = status === "PRESENT" && calc.isLate ? "LATE" : status;
  return { ...calc, status: finalStatus, worked };
}

/** Record or correct one employee's day (manager). */
export async function saveAttendance(ctx: Ctx, input: unknown) {
  authorize(ctx, "attendance.manage");
  const d = parse(attendanceSchema, input);
  return withTransaction(async (tx) => {
    const e = await tx.employee.findFirst({ where: { id: d.employeeId, branchId: ctx.branchId, deletedAt: null }, include: { workShift: true } });
    if (!e) throw notFound("Employee");
    if (d.workDate < dateToDay(e.joiningDate) || (e.leavingDate && d.workDate > dateToDay(e.leavingDate))) {
      throw validationFailed({ workDate: [`${e.fullName} was not employed on this date`] });
    }
    if (d.workDate > (await todayFor(ctx.branchId, tx))) throw validationFailed({ workDate: ["Attendance cannot be recorded for a future date"] });
    const c = await context(tx, ctx.branchId);
    const worked = WORKED_STATUSES.includes(d.status);
    const { checkInAt, checkOutAt } = worked ? timesToInstants(d.workDate, d.checkIn, d.checkOut, c.timeZone, c.cutoffHour) : { checkInAt: null, checkOutAt: null };
    const r = derive(e, d.workDate, d.status, checkInAt, checkOutAt, c);
    const existing = await tx.attendance.findUnique({ where: { employeeId_workDate: { employeeId: e.id, workDate: dayToDate(d.workDate) } } });
    if (existing?.lockedAt) throw invalidState("This day is covered by an approved payroll and is locked.");
    const data = {
      status: r.status,
      checkInAt,
      checkOutAt,
      lateMinutes: r.lateMinutes,
      workedMinutes: r.workedMinutes,
      overtimeMinutes: r.overtimeMinutes,
      workShiftId: e.workShiftId,
      note: d.note || null,
      recordedById: ctx.user.id,
      source: existing?.source === "SELF" || existing?.source === "BIOMETRIC" ? existing.source : ("MANUAL" as const),
    };
    const row = existing
      ? await tx.attendance.update({ where: { id: existing.id }, data })
      : await tx.attendance.create({ data: { ...data, branchId: ctx.branchId, employeeId: e.id, workDate: dayToDate(d.workDate), source: "MANUAL" } });
    await recordAudit(tx, ctx, {
      action: existing ? "attendance.update" : "attendance.create",
      module: "attendance",
      entityType: "attendance",
      entityId: row.id,
      before: existing ? { status: existing.status, checkInAt: existing.checkInAt, checkOutAt: existing.checkOutAt } : undefined,
      after: { employee: e.fullName, workDate: d.workDate, status: r.status, checkInAt, checkOutAt },
    });
    return { id: row.id, status: r.status, lateMinutes: r.lateMinutes, workedMinutes: r.workedMinutes, overtimeMinutes: r.overtimeMinutes };
  });
}

/** Mark several employees with one status for a day, skipping those already recorded. */
export async function markMany(ctx: Ctx, input: unknown) {
  authorize(ctx, "attendance.manage");
  const d = parse(z.object({ workDate: z.iso.date(), status: z.enum(["PRESENT", "ABSENT", "OFF", "PAID_LEAVE"]), employeeIds: z.array(z.uuid()).min(1).max(300) }), input);
  return withTransaction(async (tx) => {
    if (d.workDate > (await todayFor(ctx.branchId, tx))) throw validationFailed({ workDate: ["Attendance cannot be recorded for a future date"] });
    const staff = (await employeesOn(ctx.branchId, d.workDate)).filter((e) => d.employeeIds.includes(e.id));
    const existing = await tx.attendance.findMany({ where: { workDate: dayToDate(d.workDate), employeeId: { in: staff.map((s) => s.id) } }, select: { employeeId: true } });
    const done = new Set(existing.map((x) => x.employeeId));
    const todo = staff.filter((s) => !done.has(s.id));
    if (todo.length) {
      await tx.attendance.createMany({
        data: todo.map((s) => ({ branchId: ctx.branchId, employeeId: s.id, workDate: dayToDate(d.workDate), status: d.status, workShiftId: s.workShiftId, source: "MANUAL" as const, recordedById: ctx.user.id })),
      });
    }
    await recordAudit(tx, ctx, { action: "attendance.bulk", module: "attendance", entityType: "attendance", after: { workDate: d.workDate, status: d.status, count: todo.length } });
    return { marked: todo.length, skipped: staff.length - todo.length };
  });
}

export type AttendanceSheetRow = {
  employeeId: string;
  employeeCode: string;
  name: string;
  designation: string;
  shift: string | null;
  expectedOff: boolean;
  record: null | {
    status: AttendanceStatusKey;
    checkIn: string;
    checkOut: string;
    lateMinutes: number;
    workedMinutes: number;
    overtimeMinutes: number;
    source: string;
    note: string;
    locked: boolean;
  };
};

/** The daily attendance sheet: everyone employed that day, with their record if any. */
export async function attendanceSheet(ctx: Ctx, isoDate?: string) {
  authorize(ctx, "attendance.manage");
  const today = await todayFor(ctx.branchId);
  const date = isoDate && /^\d{4}-\d{2}-\d{2}$/.test(isoDate) ? isoDate : today;
  const staff = (await employeesOn(ctx.branchId, date)).filter((e) => e.status !== "LEFT" || (e.leavingDate && dateToDay(e.leavingDate) >= date));
  const c = await context(db, ctx.branchId);
  const rows = await db.attendance.findMany({ where: { workDate: dayToDate(date), employeeId: { in: staff.map((s) => s.id) } } });
  const sheet: AttendanceSheetRow[] = staff.map((e) => {
    const r = rows.find((x) => x.employeeId === e.id);
    return {
      employeeId: e.id,
      employeeCode: e.employeeCode,
      name: e.fullName,
      designation: e.designation,
      shift: e.workShift ? `${formatHm(e.workShift.startMinute)}–${formatHm(e.workShift.endMinute)}` : null,
      expectedOff: e.weeklyOffDays.includes(weekday(date)),
      record: r
        ? {
            status: r.status,
            checkIn: r.checkInAt ? formatHm(localMinute(r.checkInAt, c.timeZone)) : "",
            checkOut: r.checkOutAt ? formatHm(localMinute(r.checkOutAt, c.timeZone)) : "",
            lateMinutes: r.lateMinutes,
            workedMinutes: r.workedMinutes,
            overtimeMinutes: r.overtimeMinutes,
            source: r.source,
            note: r.note ?? "",
            locked: !!r.lockedAt,
          }
        : null,
    };
  });
  const count = (s: AttendanceStatusKey[]) => sheet.filter((r) => r.record && s.includes(r.record.status)).length;
  return {
    date,
    today,
    rows: sheet,
    totals: { staff: sheet.length, present: count(["PRESENT", "LATE", "HALF_DAY"]), late: count(["LATE"]), absent: count(["ABSENT", "UNPAID_LEAVE"]), leave: count(["PAID_LEAVE", "UNPAID_LEAVE"]), unrecorded: sheet.filter((r) => !r.record).length },
  };
}

/** Per-employee totals for a month ("2026-10"). */
export async function monthlySummary(ctx: Ctx, month?: string) {
  authorizeAny(ctx, ["attendance.manage", "payroll.prepare"]);
  const today = await todayFor(ctx.branchId);
  const m = month && /^\d{4}-\d{2}$/.test(month) ? month : today.slice(0, 7);
  const start = `${m}-01`;
  const [y, mo] = m.split("-").map(Number) as [number, number];
  const end = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
  const lastCounted = end < today ? end : today;
  const employees = await db.employee.findMany({
    where: { branchId: ctx.branchId, deletedAt: null, joiningDate: { lte: dayToDate(end) }, OR: [{ leavingDate: null }, { leavingDate: { gte: dayToDate(start) } }] },
    orderBy: { fullName: "asc" },
  });
  const rows = await db.attendance.findMany({ where: { branchId: ctx.branchId, workDate: { gte: dayToDate(start), lte: dayToDate(end) } } });
  return {
    month: m,
    rows: employees.map((e) => {
      const mine = rows.filter((r) => r.employeeId === e.id);
      const n = (s: AttendanceStatusKey[]) => mine.filter((r) => s.includes(r.status)).length;
      const days = start > lastCounted ? [] : eachDay(start, lastCounted).filter((d) => d >= dateToDay(e.joiningDate) && (!e.leavingDate || d <= dateToDay(e.leavingDate)));
      const recorded = new Set(mine.map((r) => dateToDay(r.workDate)));
      const unrecorded = days.filter((d) => !recorded.has(d) && !e.weeklyOffDays.includes(weekday(d))).length;
      return {
        employeeId: e.id,
        name: e.fullName,
        code: e.employeeCode,
        present: n(["PRESENT", "LATE"]),
        late: n(["LATE"]),
        halfDays: n(["HALF_DAY"]),
        absent: n(["ABSENT"]),
        leave: n(["PAID_LEAVE", "UNPAID_LEAVE"]),
        off: n(["OFF"]),
        unrecorded,
        lateMinutes: mine.reduce((a, r) => a + r.lateMinutes, 0),
        workedMinutes: mine.reduce((a, r) => a + r.workedMinutes, 0),
        overtimeMinutes: mine.reduce((a, r) => a + r.overtimeMinutes, 0),
      };
    }),
  };
}

// ═══ Self service (time clock) ═══════════════════════════════════════════════

async function myEmployee(ctx: Ctx, tx: Db = db) {
  const e = await tx.employee.findFirst({ where: { userId: ctx.user.id, branchId: ctx.branchId, deletedAt: null }, include: { workShift: true } });
  return e && e.status !== "LEFT" ? e : null;
}

export async function myClock(ctx: Ctx) {
  authorize(ctx, "attendance.self");
  const e = await myEmployee(ctx);
  const today = await todayFor(ctx.branchId);
  if (!e) return { linked: false as const, today };
  const c = await context(db, ctx.branchId);
  const recent = await db.attendance.findMany({ where: { employeeId: e.id }, orderBy: { workDate: "desc" }, take: 14 });
  const fmt = (d: Date | null) => (d ? formatHm(localMinute(d, c.timeZone)) : "");
  const todayRow = recent.find((r) => dateToDay(r.workDate) === today) ?? null;
  return {
    linked: true as const,
    today,
    name: e.fullName,
    shift: e.workShift ? `${e.workShift.name} ${formatHm(e.workShift.startMinute)}–${formatHm(e.workShift.endMinute)}` : null,
    state: !todayRow?.checkInAt ? ("OUT" as const) : todayRow.checkOutAt ? ("DONE" as const) : ("IN" as const),
    todayRow: todayRow ? { status: todayRow.status, checkIn: fmt(todayRow.checkInAt), checkOut: fmt(todayRow.checkOutAt), lateMinutes: todayRow.lateMinutes, workedMinutes: todayRow.workedMinutes } : null,
    recent: recent.map((r) => ({ date: dateToDay(r.workDate), status: r.status, checkIn: fmt(r.checkInAt), checkOut: fmt(r.checkOutAt), workedMinutes: r.workedMinutes, lateMinutes: r.lateMinutes })),
  };
}

/** Check in or out for today. The server clock is used, never the device's. */
export async function clock(ctx: Ctx, action: unknown, now = new Date()) {
  authorize(ctx, "attendance.self");
  const a = z.enum(["IN", "OUT"]).parse(action);
  return withTransaction(async (tx) => {
    const e = await myEmployee(ctx, tx);
    if (!e) throw invalidState("Your login is not linked to an employee profile. Ask a manager.");
    const today = await todayFor(ctx.branchId, tx, now);
    const c = await context(tx, ctx.branchId);
    const existing = await tx.attendance.findUnique({ where: { employeeId_workDate: { employeeId: e.id, workDate: dayToDate(today) } } });
    if (existing?.lockedAt) throw invalidState("Today's attendance is locked.");
    if (a === "IN") {
      if (existing?.checkInAt) throw conflict("You have already checked in today.");
      // If a manager had marked leave/off, checking in means they came anyway: it becomes a worked day.
      const r = derive(e, today, "PRESENT", now, null, c);
      const data = { status: r.status, checkInAt: now, lateMinutes: r.lateMinutes, workShiftId: e.workShiftId, source: "SELF" as const, recordedById: ctx.user.id };
      const row = existing
        ? await tx.attendance.update({ where: { id: existing.id }, data })
        : await tx.attendance.create({ data: { ...data, branchId: ctx.branchId, employeeId: e.id, workDate: dayToDate(today) } });
      await recordAudit(tx, ctx, { action: "attendance.check_in", module: "attendance", entityType: "attendance", entityId: row.id, after: { workDate: today, at: now, status: r.status } });
      return { state: "IN" as const, status: r.status, lateMinutes: r.lateMinutes };
    }
    if (!existing?.checkInAt) throw invalidState("Check in first.");
    if (existing.checkOutAt) throw conflict("You have already checked out today.");
    const r = derive(e, today, existing.status, existing.checkInAt, now, c);
    await tx.attendance.update({ where: { id: existing.id }, data: { checkOutAt: now, workedMinutes: r.workedMinutes, overtimeMinutes: r.overtimeMinutes } });
    await recordAudit(tx, ctx, { action: "attendance.check_out", module: "attendance", entityType: "attendance", entityId: existing.id, after: { workDate: today, at: now, workedMinutes: r.workedMinutes } });
    return { state: "DONE" as const, workedMinutes: r.workedMinutes, overtimeMinutes: r.overtimeMinutes };
  });
}
