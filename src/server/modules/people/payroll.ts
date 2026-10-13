import "server-only";
import { z } from "zod";
import { db, withTransaction, Prisma, type Db } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";
import { authorize, authorizeAny } from "@/server/core/rbac";
import { recordAudit } from "@/server/core/audit";
import { conflict, invalidState, notFound, validationFailed } from "@/server/core/errors";
import { zodFieldErrors } from "@/server/core/action";
import { nextSequence, formatDocNumber } from "@/server/core/numbering";
import { dayToDate, dateToDay, todayFor } from "@/server/core/today";
import { getSetting } from "@/server/modules/settings/service";
import { createExpenseInTx, voidExpenseInTx, systemCategoryId, EXPENSE_METHODS } from "@/server/modules/expenses/service";
import { calcPayslip, type PayrollSettings } from "@/lib/payroll";
import { shiftLength } from "@/lib/attendance";

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw validationFailed(zodFieldErrors(r.error));
  return r.data;
}

const amount = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,2})?$/, "Enter an amount")
  .refine((v) => Number(v) > 0, "Must be more than zero");

// ═══ Advances ════════════════════════════════════════════════════════════════

export const advanceSchema = z
  .object({
    employeeId: z.uuid(),
    amount,
    issuedOn: z.iso.date(),
    installment: z.union([amount, z.literal("")]).optional().default(""),
    paymentMethod: z.enum(EXPENSE_METHODS),
    terminalId: z.uuid().optional().nullable(),
    reason: z.string().trim().max(200).optional().default(""),
  })
  .superRefine((v, c) => {
    if (v.paymentMethod === "CASH_DRAWER" && !v.terminalId) c.addIssue({ code: "custom", path: ["terminalId"], message: "Choose the till the cash comes from" });
    if (v.installment && Number(v.installment) > Number(v.amount)) c.addIssue({ code: "custom", path: ["installment"], message: "Cannot be more than the advance" });
  });

/** Give an employee a salary advance: paid out now (an expense), recovered from payroll. */
export async function issueAdvance(ctx: Ctx, input: unknown) {
  authorize(ctx, "payroll.prepare");
  const d = parse(advanceSchema, input);
  return withTransaction(async (tx) => {
    const e = await tx.employee.findFirst({ where: { id: d.employeeId, branchId: ctx.branchId, deletedAt: null } });
    if (!e) throw notFound("Employee");
    if (e.status === "LEFT") throw invalidState(`${e.fullName} has left.`);
    if (d.issuedOn > (await todayFor(ctx.branchId, tx))) throw validationFailed({ issuedOn: ["The date cannot be in the future"] });
    const adv = await tx.employeeAdvance.create({
      data: { branchId: ctx.branchId, employeeId: e.id, amount: D(d.amount), installment: d.installment ? D(d.installment) : null, issuedOn: dayToDate(d.issuedOn), reason: d.reason || null, createdById: ctx.user.id },
    });
    const ex = await createExpenseInTx(tx, ctx, {
      categoryId: await systemCategoryId(tx, "salary_advances"),
      amount: D(d.amount),
      expenseDate: d.issuedOn,
      paymentMethod: d.paymentMethod,
      terminalId: d.terminalId,
      payee: e.fullName,
      description: `Salary advance${d.reason ? `: ${d.reason}` : ""}`,
      sourceType: "employee_advance",
      sourceId: adv.id,
    });
    await tx.employeeAdvance.update({ where: { id: adv.id }, data: { expenseId: ex.id } });
    await recordAudit(tx, ctx, { action: "advance.issue", module: "payroll", entityType: "employee", entityId: e.id, after: { advanceId: adv.id, amount: d.amount, installment: d.installment || null } });
    return { id: adv.id };
  });
}

export async function cancelAdvance(ctx: Ctx, advanceId: string, reason: unknown) {
  authorize(ctx, "payroll.prepare");
  const why = z.string().trim().min(3, "Give a reason").max(200).safeParse(reason);
  if (!why.success) throw validationFailed({ reason: why.error.issues.map((i) => i.message) });
  return withTransaction(async (tx) => {
    const a = await tx.employeeAdvance.findFirst({ where: { id: advanceId, branchId: ctx.branchId } });
    if (!a) throw notFound("Advance");
    if (a.status !== "OPEN" || a.recoveredAmount.greaterThan(0)) throw invalidState("Only an advance with nothing recovered yet can be cancelled.");
    const inPayroll = await tx.payslipLine.findFirst({ where: { advanceId: a.id, payslip: { run: { status: { in: ["DRAFT", "APPROVED"] } } } } });
    if (inPayroll) throw invalidState("This advance is in a payroll run. Remove it there (recalculate the draft) first.");
    if (a.expenseId) await voidExpenseInTx(tx, ctx, a.expenseId, `Advance cancelled: ${why.data}`);
    await tx.employeeAdvance.update({ where: { id: a.id }, data: { status: "CANCELLED" } });
    await recordAudit(tx, ctx, { action: "advance.cancel", module: "payroll", entityType: "employee", entityId: a.employeeId, after: { advanceId: a.id }, reason: why.data });
  });
}

export async function employeeAdvances(ctx: Ctx, employeeId: string) {
  authorizeAny(ctx, ["payroll.prepare", "employees.sensitive"]);
  const rows = await db.employeeAdvance.findMany({ where: { employeeId, branchId: ctx.branchId }, orderBy: { issuedOn: "desc" } });
  return rows.map((a) => ({
    id: a.id,
    issuedOn: dateToDay(a.issuedOn),
    amount: a.amount.toFixed(2),
    recovered: a.recoveredAmount.toFixed(2),
    balance: a.amount.minus(a.recoveredAmount).toFixed(2),
    installment: a.installment?.toFixed(2) ?? null,
    reason: a.reason,
    status: a.status,
  }));
}

// ═══ Payroll runs ════════════════════════════════════════════════════════════

export const runSchema = z
  .object({
    periodStart: z.iso.date(),
    periodEnd: z.iso.date(),
    notes: z.string().trim().max(300).optional().default(""),
  })
  .superRefine((v, c) => {
    if (v.periodEnd < v.periodStart) c.addIssue({ code: "custom", path: ["periodEnd"], message: "Must be after the start" });
    const days = (Date.parse(v.periodEnd) - Date.parse(v.periodStart)) / 86_400_000 + 1;
    if (days > 62) c.addIssue({ code: "custom", path: ["periodEnd"], message: "A payroll period can be at most two months" });
  });

async function payrollSettings(tx: Db): Promise<PayrollSettings> {
  const s = await getSetting("payroll", tx);
  return { dailyRateBasis: s.dailyRateBasis, unrecordedDays: s.unrecordedDays, latesPerDayDeduction: s.latesPerDayDeduction, overtimeMultiplier: s.overtimeMultiplier, standardShiftHours: s.standardShiftHours };
}

/** (Re)build one employee's payslip in a draft run, keeping manual lines. */
async function buildPayslip(tx: Db, run: { id: string; periodStart: Date; periodEnd: Date }, employeeId: string, settings: PayrollSettings) {
  const e = await tx.employee.findUniqueOrThrow({ where: { id: employeeId }, include: { workShift: true } });
  const start = dateToDay(run.periodStart);
  const end = dateToDay(run.periodEnd);
  const attendance = await tx.attendance.findMany({ where: { employeeId, workDate: { gte: run.periodStart, lte: run.periodEnd } } });
  const existing = await tx.payslip.findUnique({ where: { payrollRunId_employeeId: { payrollRunId: run.id, employeeId } }, include: { lines: true } });
  const manualLines = (existing?.lines ?? []).filter((l) => l.isManual).map((l) => ({ kind: l.kind, code: l.code, label: l.label, amount: l.amount.toFixed(2) }));
  // Advances already being recovered by another unpaid run are left alone.
  const advances = await tx.employeeAdvance.findMany({ where: { employeeId, status: "OPEN", issuedOn: { lte: run.periodEnd } } });
  const pending = await tx.payslipLine.findMany({
    where: { advanceId: { in: advances.map((a) => a.id) }, payslip: { payrollRunId: { not: run.id }, paidAt: null, run: { status: { in: ["DRAFT", "APPROVED"] } } } },
  });
  const shiftHours = e.workShift ? Math.max(1, Math.round((shiftLength(e.workShift) - e.workShift.breakMinutes) / 60)) : settings.standardShiftHours;
  const calc = calcPayslip({
    payType: e.payType,
    baseRate: e.baseRate.toFixed(2),
    overtimeRate: e.overtimeRate?.toFixed(2) ?? null,
    periodStart: start,
    periodEnd: end,
    joiningDate: dateToDay(e.joiningDate),
    leavingDate: e.leavingDate ? dateToDay(e.leavingDate) : null,
    weeklyOffDays: e.weeklyOffDays,
    shiftHours,
    attendance: attendance.map((a) => ({ date: dateToDay(a.workDate), status: a.status, workedMinutes: a.workedMinutes, overtimeMinutes: a.overtimeMinutes })),
    advances: advances
      .map((a) => {
        const held = pending.filter((p) => p.advanceId === a.id).reduce((s, p) => s.plus(p.amount), D(0));
        return { id: a.id, balance: a.amount.minus(a.recoveredAmount).minus(held).toFixed(2), installment: a.installment?.toFixed(2) ?? null, issuedOn: dateToDay(a.issuedOn) };
      })
      .filter((a) => D(a.balance).greaterThan(0)),
    manualLines,
    settings,
  });
  const data = {
    employeeName: e.fullName,
    employeeCode: e.employeeCode,
    designation: e.designation,
    payType: e.payType,
    baseRate: e.baseRate,
    periodDays: calc.periodDays,
    payableDays: D(calc.payableDays),
    presentDays: D(calc.presentDays),
    absentDays: D(calc.absentDays),
    leaveDays: D(calc.leaveDays),
    offDays: calc.offDays,
    unrecordedDays: calc.unrecordedDays,
    lateCount: calc.lateCount,
    workedMinutes: calc.workedMinutes,
    overtimeMinutes: calc.overtimeMinutes,
    gross: D(calc.gross),
    deductions: D(calc.deductions),
    net: D(calc.net),
  };
  let payslipId: string;
  if (existing) {
    await tx.payslipLine.deleteMany({ where: { payslipId: existing.id } });
    await tx.payslip.update({ where: { id: existing.id }, data });
    payslipId = existing.id;
  } else {
    payslipId = (await tx.payslip.create({ data: { ...data, payrollRunId: run.id, employeeId } })).id;
  }
  await tx.payslipLine.createMany({
    data: calc.lines.map((l, i) => ({ payslipId, kind: l.kind, code: l.code, label: l.label, amount: D(l.amount), isManual: l.isManual, advanceId: l.advanceId ?? null, sortOrder: i })),
  });
  return calc;
}

async function refreshTotals(tx: Db, runId: string) {
  const t = await tx.payslip.aggregate({ where: { payrollRunId: runId }, _sum: { gross: true, deductions: true, net: true } });
  await tx.payrollRun.update({
    where: { id: runId },
    data: { gross: t._sum.gross ?? D(0), deductions: t._sum.deductions ?? D(0), net: t._sum.net ?? D(0), version: { increment: 1 } },
  });
}

async function eligibleEmployees(tx: Db, branchId: string, start: Date, end: Date) {
  return tx.employee.findMany({
    where: { branchId, deletedAt: null, joiningDate: { lte: end }, OR: [{ leavingDate: null }, { leavingDate: { gte: start } }], baseRate: { gt: 0 } },
    orderBy: { fullName: "asc" },
    select: { id: true },
  });
}

export async function createPayrollRun(ctx: Ctx, input: unknown) {
  authorize(ctx, "payroll.prepare");
  const d = parse(runSchema, input);
  return withTransaction(async (tx) => {
    const start = dayToDate(d.periodStart);
    const end = dayToDate(d.periodEnd);
    const overlap = await tx.payrollRun.findFirst({ where: { branchId: ctx.branchId, status: { not: "CANCELLED" }, periodStart: { lte: end }, periodEnd: { gte: start } } });
    if (overlap) throw conflict(`Payroll ${overlap.runNumber} already covers part of this period.`);
    const n = await nextSequence(tx, ctx.branchId, "PAYROLL", "ALL");
    const run = await tx.payrollRun.create({
      data: { branchId: ctx.branchId, runNumber: formatDocNumber("PR", n, 4), periodStart: start, periodEnd: end, notes: d.notes || null, preparedById: ctx.user.id },
    });
    const settings = await payrollSettings(tx);
    const staff = await eligibleEmployees(tx, ctx.branchId, start, end);
    if (!staff.length) throw invalidState("No employees with a salary set were employed in this period.");
    for (const s of staff) await buildPayslip(tx, run, s.id, settings);
    await refreshTotals(tx, run.id);
    await recordAudit(tx, ctx, { action: "payroll.create", module: "payroll", entityType: "payroll_run", entityId: run.id, after: { runNumber: run.runNumber, periodStart: d.periodStart, periodEnd: d.periodEnd, employees: staff.length } });
    return { id: run.id };
  });
}

async function draftRun(tx: Db, ctx: Ctx, runId: string) {
  const run = await tx.payrollRun.findFirst({ where: { id: runId, branchId: ctx.branchId } });
  if (!run) throw notFound("Payroll run");
  if (run.status !== "DRAFT") throw invalidState(`Payroll ${run.runNumber} is ${run.status.toLowerCase()} and cannot be changed.`);
  return run;
}

/** Recalculate a draft from the latest attendance, salaries and settings. Manual lines are kept. */
export async function recalculateRun(ctx: Ctx, runId: string) {
  authorize(ctx, "payroll.prepare");
  return withTransaction(async (tx) => {
    const run = await draftRun(tx, ctx, runId);
    const settings = await payrollSettings(tx);
    const staff = await eligibleEmployees(tx, ctx.branchId, run.periodStart, run.periodEnd);
    const keep = new Set(staff.map((s) => s.id));
    await tx.payslip.deleteMany({ where: { payrollRunId: run.id, employeeId: { notIn: [...keep] } } });
    for (const s of staff) await buildPayslip(tx, run, s.id, settings);
    await refreshTotals(tx, run.id);
    await recordAudit(tx, ctx, { action: "payroll.recalculate", module: "payroll", entityType: "payroll_run", entityId: run.id });
  });
}

export const manualLineSchema = z.object({
  kind: z.enum(["EARNING", "DEDUCTION"]),
  code: z.enum(["BONUS", "ALLOWANCE", "FINE", "OTHER"]),
  label: z.string().trim().min(2, "Describe it").max(80),
  amount,
});

export async function addManualLine(ctx: Ctx, payslipId: string, input: unknown) {
  authorize(ctx, "payroll.prepare");
  const d = parse(manualLineSchema, input);
  return withTransaction(async (tx) => {
    const p = await tx.payslip.findUnique({ where: { id: payslipId } });
    if (!p) throw notFound("Payslip");
    const run = await draftRun(tx, ctx, p.payrollRunId);
    const max = await tx.payslipLine.aggregate({ where: { payslipId }, _max: { sortOrder: true } });
    await tx.payslipLine.create({ data: { payslipId, kind: d.kind, code: d.code, label: d.label, amount: D(d.amount), isManual: true, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
    await buildPayslip(tx, run, p.employeeId, await payrollSettings(tx));
    await refreshTotals(tx, run.id);
    await recordAudit(tx, ctx, { action: "payroll.line_add", module: "payroll", entityType: "payslip", entityId: payslipId, after: d });
  });
}

export async function removeManualLine(ctx: Ctx, lineId: string) {
  authorize(ctx, "payroll.prepare");
  return withTransaction(async (tx) => {
    const l = await tx.payslipLine.findUnique({ where: { id: lineId }, include: { payslip: true } });
    if (!l || !l.isManual) throw notFound("Line");
    const run = await draftRun(tx, ctx, l.payslip.payrollRunId);
    await tx.payslipLine.delete({ where: { id: lineId } });
    await buildPayslip(tx, run, l.payslip.employeeId, await payrollSettings(tx));
    await refreshTotals(tx, run.id);
    await recordAudit(tx, ctx, { action: "payroll.line_remove", module: "payroll", entityType: "payslip", entityId: l.payslipId, before: { label: l.label, amount: l.amount.toFixed(2) } });
  });
}

export async function cancelRun(ctx: Ctx, runId: string) {
  authorize(ctx, "payroll.prepare");
  return withTransaction(async (tx) => {
    const run = await draftRun(tx, ctx, runId);
    await tx.payrollRun.update({ where: { id: run.id }, data: { status: "CANCELLED", cancelledAt: new Date(), version: { increment: 1 } } });
    await recordAudit(tx, ctx, { action: "payroll.cancel", module: "payroll", entityType: "payroll_run", entityId: run.id, before: { status: "DRAFT" }, after: { status: "CANCELLED" } });
  });
}

/** Approve a draft: amounts and the covered attendance are frozen from now on. */
export async function approveRun(ctx: Ctx, runId: string, version: number) {
  authorize(ctx, "payroll.approve");
  return withTransaction(async (tx) => {
    const run = await draftRun(tx, ctx, runId);
    if (run.version !== version) throw conflict("This payroll changed while you were looking at it. Review it again before approving.");
    const slips = await tx.payslip.findMany({ where: { payrollRunId: run.id }, select: { employeeId: true } });
    if (!slips.length) throw invalidState("There are no payslips in this run.");
    const updated = await tx.payrollRun.updateMany({ where: { id: run.id, version }, data: { status: "APPROVED", approvedAt: new Date(), approvedById: ctx.user.id, version: { increment: 1 } } });
    if (updated.count !== 1) throw conflict("This payroll changed while you were looking at it.");
    await tx.attendance.updateMany({
      where: { employeeId: { in: slips.map((s) => s.employeeId) }, workDate: { gte: run.periodStart, lte: run.periodEnd }, lockedAt: null },
      data: { lockedAt: new Date() },
    });
    await recordAudit(tx, ctx, { action: "payroll.approve", module: "payroll", entityType: "payroll_run", entityId: run.id, before: { status: "DRAFT" }, after: { status: "APPROVED", net: run.net.toFixed(2) } });
  });
}

export const paySchema = z
  .object({
    paymentMethod: z.enum(EXPENSE_METHODS),
    terminalId: z.uuid().optional().nullable(),
    paidOn: z.iso.date(),
    reference: z.string().trim().max(80).optional().default(""),
  })
  .superRefine((v, c) => {
    if (v.paymentMethod === "CASH_DRAWER" && !v.terminalId) c.addIssue({ code: "custom", path: ["terminalId"], message: "Choose the till the cash comes from" });
  });

async function payOne(tx: Db, ctx: Ctx, payslipId: string, d: z.output<typeof paySchema>) {
  const p = await tx.payslip.findUnique({ where: { id: payslipId }, include: { run: true, lines: true } });
  if (!p || p.run.branchId !== ctx.branchId) throw notFound("Payslip");
  if (p.paidAt) throw conflict(`${p.employeeName} has already been paid.`);
  if (p.run.status !== "APPROVED") throw invalidState("Approve the payroll before paying it.");
  let expenseId: string | null = null;
  if (p.net.greaterThan(0)) {
    const ex = await createExpenseInTx(tx, ctx, {
      categoryId: await systemCategoryId(tx, "salaries"),
      amount: p.net,
      expenseDate: d.paidOn,
      paymentMethod: d.paymentMethod,
      terminalId: d.terminalId,
      payee: p.employeeName,
      description: `Salary ${p.run.runNumber} (${dateToDay(p.run.periodStart)} to ${dateToDay(p.run.periodEnd)})`,
      reference: d.reference || null,
      sourceType: "payslip",
      sourceId: p.id,
    });
    expenseId = ex.id;
  }
  for (const l of p.lines.filter((x) => x.code === "ADVANCE" && x.advanceId)) {
    const a = await tx.employeeAdvance.findUniqueOrThrow({ where: { id: l.advanceId! } });
    const recovered = Prisma.Decimal.min(a.amount, a.recoveredAmount.plus(l.amount));
    await tx.employeeAdvance.update({ where: { id: a.id }, data: { recoveredAmount: recovered, status: recovered.greaterThanOrEqualTo(a.amount) ? "RECOVERED" : "OPEN" } });
  }
  await tx.payslip.update({ where: { id: p.id }, data: { paidAt: new Date(), paymentMethod: d.paymentMethod, expenseId } });
  await recordAudit(tx, ctx, { action: "payroll.pay", module: "payroll", entityType: "payslip", entityId: p.id, after: { employee: p.employeeName, net: p.net.toFixed(2), method: d.paymentMethod } });
  return p.payrollRunId;
}

async function closeIfAllPaid(tx: Db, runId: string) {
  const unpaid = await tx.payslip.count({ where: { payrollRunId: runId, paidAt: null } });
  if (unpaid === 0) await tx.payrollRun.update({ where: { id: runId }, data: { status: "PAID", paidAt: new Date(), version: { increment: 1 } } });
  return unpaid === 0;
}

export async function payPayslip(ctx: Ctx, payslipId: string, input: unknown) {
  authorize(ctx, "payroll.approve");
  const d = parse(paySchema, input);
  return withTransaction(async (tx) => {
    const runId = await payOne(tx, ctx, payslipId, d);
    return { runPaid: await closeIfAllPaid(tx, runId) };
  });
}

export async function payAll(ctx: Ctx, runId: string, input: unknown) {
  authorize(ctx, "payroll.approve");
  const d = parse(paySchema, input);
  return withTransaction(async (tx) => {
    const run = await tx.payrollRun.findFirst({ where: { id: runId, branchId: ctx.branchId } });
    if (!run) throw notFound("Payroll run");
    if (run.status !== "APPROVED") throw invalidState("Approve the payroll before paying it.");
    const slips = await tx.payslip.findMany({ where: { payrollRunId: run.id, paidAt: null }, orderBy: { employeeName: "asc" } });
    for (const s of slips) await payOne(tx, ctx, s.id, d);
    await closeIfAllPaid(tx, run.id);
    return { paid: slips.length };
  });
}

// ═══ Reading ═════════════════════════════════════════════════════════════════

export async function listPayrollRuns(ctx: Ctx) {
  authorizeAny(ctx, ["payroll.prepare", "payroll.approve"]);
  const rows = await db.payrollRun.findMany({ where: { branchId: ctx.branchId }, orderBy: { periodStart: "desc" }, take: 60, include: { _count: { select: { payslips: true } } } });
  return rows.map((r) => ({
    id: r.id,
    runNumber: r.runNumber,
    periodStart: dateToDay(r.periodStart),
    periodEnd: dateToDay(r.periodEnd),
    status: r.status,
    employees: r._count.payslips,
    gross: r.gross.toFixed(2),
    net: r.net.toFixed(2),
  }));
}

export async function getPayrollRun(ctx: Ctx, runId: string) {
  authorizeAny(ctx, ["payroll.prepare", "payroll.approve"]);
  const r = await db.payrollRun.findFirst({
    where: { id: runId, branchId: ctx.branchId },
    include: { payslips: { orderBy: { employeeName: "asc" }, include: { lines: { orderBy: { sortOrder: "asc" } } } } },
  });
  if (!r) throw notFound("Payroll run");
  const userIds = [r.preparedById, r.approvedById].filter((x): x is string => !!x);
  const users = userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const name = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;
  return {
    id: r.id,
    runNumber: r.runNumber,
    periodStart: dateToDay(r.periodStart),
    periodEnd: dateToDay(r.periodEnd),
    status: r.status,
    version: r.version,
    gross: r.gross.toFixed(2),
    deductions: r.deductions.toFixed(2),
    net: r.net.toFixed(2),
    notes: r.notes,
    preparedBy: name(r.preparedById),
    approvedBy: name(r.approvedById),
    approvedAt: r.approvedAt,
    paidAt: r.paidAt,
    payslips: r.payslips.map(serializePayslip),
  };
}

type PayslipWithLines = Prisma.PayslipGetPayload<{ include: { lines: true } }>;

function serializePayslip(p: PayslipWithLines) {
  return {
    id: p.id,
    employeeId: p.employeeId,
    employeeName: p.employeeName,
    employeeCode: p.employeeCode,
    designation: p.designation,
    payType: p.payType,
    baseRate: p.baseRate.toFixed(2),
    periodDays: p.periodDays,
    payableDays: p.payableDays.toFixed(1),
    presentDays: p.presentDays.toFixed(1),
    absentDays: p.absentDays.toFixed(1),
    leaveDays: p.leaveDays.toFixed(1),
    offDays: p.offDays,
    unrecordedDays: p.unrecordedDays,
    lateCount: p.lateCount,
    workedMinutes: p.workedMinutes,
    overtimeMinutes: p.overtimeMinutes,
    gross: p.gross.toFixed(2),
    deductions: p.deductions.toFixed(2),
    net: p.net.toFixed(2),
    paidAt: p.paidAt,
    paymentMethod: p.paymentMethod,
    lines: p.lines.map((l) => ({ id: l.id, kind: l.kind, code: l.code, label: l.label, amount: l.amount.toFixed(2), isManual: l.isManual })),
  };
}

export async function getPayslip(ctx: Ctx, payslipId: string) {
  authorizeAny(ctx, ["payroll.prepare", "payroll.approve"]);
  const p = await db.payslip.findUnique({ where: { id: payslipId }, include: { lines: { orderBy: { sortOrder: "asc" } }, run: true } });
  if (!p || p.run.branchId !== ctx.branchId) throw notFound("Payslip");
  return { ...serializePayslip(p), run: { id: p.run.id, runNumber: p.run.runNumber, periodStart: dateToDay(p.run.periodStart), periodEnd: dateToDay(p.run.periodEnd), status: p.run.status } };
}

export async function employeePayslips(ctx: Ctx, employeeId: string) {
  authorizeAny(ctx, ["payroll.prepare", "payroll.approve"]);
  const rows = await db.payslip.findMany({ where: { employeeId, run: { branchId: ctx.branchId, status: { not: "CANCELLED" } } }, orderBy: { run: { periodStart: "desc" } }, take: 24, include: { run: true } });
  return rows.map((p) => ({ id: p.id, runNumber: p.run.runNumber, period: `${dateToDay(p.run.periodStart)} to ${dateToDay(p.run.periodEnd)}`, status: p.run.status, net: p.net.toFixed(2), paidAt: p.paidAt }));
}
