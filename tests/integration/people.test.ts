import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";
import { openShift, computeShiftSummary } from "@/server/modules/shifts/service";
import { createExpense, updateExpense, voidExpense, listExpenses, listExpenseCategories, saveExpenseCategory } from "@/server/modules/expenses/service";
import { saveEmployee, getEmployee, listEmployees, saveWorkShift } from "@/server/modules/people/employees";
import { saveAttendance, clock, myClock, markMany, attendanceSheet } from "@/server/modules/people/attendance";
import {
  issueAdvance,
  cancelAdvance,
  createPayrollRun,
  getPayrollRun,
  approveRun,
  payPayslip,
  payAll,
  addManualLine,
  recalculateRun,
  employeeAdvances,
} from "@/server/modules/people/payroll";
import { todayFor } from "@/server/core/today";
import { localInstant } from "@/lib/attendance";
import { resetDatabase, ctxForRole, ctxFor, createUserWithRole, counterTerminalId } from "./helpers";

let owner: Ctx;
let manager: Ctx;
let cashier: Ctx;
let terminalId: string;
let today: string;
let lastMonth: { start: string; end: string };
let categoryId: string;

beforeEach(async () => {
  await resetDatabase();
  owner = await ctxForRole("owner");
  manager = await ctxForRole("manager");
  cashier = await ctxForRole("cashier");
  terminalId = await counterTerminalId();
  await openShift(cashier, { terminalId, openingCash: "5000" });
  today = await todayFor(owner.branchId);
  const [y, m] = today.split("-").map(Number) as [number, number];
  const start = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
  lastMonth = { start, end };
  categoryId = (await db.expenseCategory.findFirstOrThrow({ where: { name: "Electricity" } })).id;
});

const expense = (over: Record<string, unknown> = {}) => ({
  categoryId,
  amount: "1200",
  expenseDate: today,
  paymentMethod: "CASH_DRAWER",
  terminalId,
  description: "Ice and lemons",
  ...over,
});

describe("expenses", () => {
  it("pays cash from the cashier's own till, numbers it and reduces expected cash", async () => {
    const r = await createExpense(cashier, expense());
    expect(r.expenseNumber).toBe("EXP-00001");
    const shift = await db.cashShift.findFirstOrThrow({ where: { status: "OPEN" } });
    const tx = await db.cashTransaction.findFirstOrThrow({ where: { cashShiftId: shift.id, type: "EXPENSE" } });
    expect(tx.amount.toString()).toBe("-1200");
    expect((await computeShiftSummary(shift.id)).expectedCash).toBe("3800.00");
  });

  it("limits cashiers to their own till and cash, and to what is in the drawer", async () => {
    await expect(createExpense(cashier, expense({ paymentMethod: "BANK_TRANSFER", terminalId: null }))).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    const other = await ctxForRole("cashier");
    await expect(createExpense(other, expense())).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(createExpense(cashier, expense({ amount: "6000" }))).rejects.toMatchObject({ code: "INVALID_STATE" });
    const kitchen = await ctxForRole("kitchen");
    await expect(createExpense(kitchen, expense())).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    // Managers may take cash from any open till.
    await expect(createExpense(manager, expense())).resolves.toBeTruthy();
  });

  it("rejects future dates and payroll-only categories", async () => {
    await expect(createExpense(manager, expense({ expenseDate: "2999-01-01" }))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    const salaries = await db.expenseCategory.findFirstOrThrow({ where: { systemKey: "salaries" } });
    await expect(createExpense(manager, expense({ categoryId: salaries.id }))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect((await listExpenseCategories(manager)).some((c) => c.system)).toBe(false);
    await expect(saveExpenseCategory(manager, salaries.id, { name: "Salaries", isActive: false })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("voids a till expense back into the drawer, and blocks changing till amounts", async () => {
    const { id } = await createExpense(cashier, expense());
    await expect(updateExpense(manager, id, expense({ amount: "1000" }))).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(voidExpense(cashier, id, "typo")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await voidExpense(manager, id, "Entered twice");
    const shift = await db.cashShift.findFirstOrThrow({ where: { status: "OPEN" } });
    expect((await computeShiftSummary(shift.id)).expectedCash).toBe("5000.00");
    await expect(voidExpense(manager, id, "again")).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(db.expense.delete({ where: { id } })).rejects.toThrow();
  });

  it("edits bank expenses with an audit trail, and cashiers only list their own", async () => {
    const { id } = await createExpense(manager, expense({ paymentMethod: "BANK_TRANSFER", terminalId: null, amount: "9000" }));
    await updateExpense(manager, id, expense({ paymentMethod: "BANK_TRANSFER", terminalId: null, amount: "9500" }));
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "expense.update", entityId: id } });
    expect(audit.after).toMatchObject({ amount: "9500.00" });
    await createExpense(cashier, expense());
    expect((await listExpenses(cashier, {})).rows).toHaveLength(1);
    const all = await listExpenses(manager, {});
    expect(all.rows).toHaveLength(2);
    expect(all.total).toBe("10700.00");
    expect(all.byCategory[0]).toEqual({ name: "Electricity", total: "10700.00" });
  });
});

async function employee(ctx: Ctx, over: Record<string, unknown> = {}) {
  return saveEmployee(ctx, null, {
    fullName: "Ali Raza",
    designation: "Cook",
    joiningDate: "2025-01-01",
    payType: "MONTHLY",
    baseRate: "30000",
    weeklyOffDays: [],
    ...over,
  });
}

describe("employees", () => {
  it("encrypts the CNIC and hides salary fields without the sensitive permission", async () => {
    const { id } = await employee(owner, { nationalId: "3520212345671", bankAccount: "PK36SCBL0000001123456702" });
    const raw = await db.employee.findUniqueOrThrow({ where: { id } });
    expect(raw.employeeCode).toBe("EMP-001");
    expect(raw.nationalIdEnc).not.toContain("3520212345671");
    expect(raw.nationalIdLast4).toBe("5671");
    expect((await getEmployee(owner, id)).form.nationalId).toBe("35202-1234567-1");
    expect(await db.auditLog.count({ where: { action: "employee.sensitive_view", entityId: id } })).toBe(1);

    const role = await db.role.findUniqueOrThrow({ where: { key: "manager" } });
    const perm = await db.permission.findUniqueOrThrow({ where: { key: "employees.sensitive" } });
    await db.rolePermission.delete({ where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } } });
    const limited = await ctxFor(manager.user.id);
    const seen = await getEmployee(limited, id);
    expect(seen.form).not.toHaveProperty("nationalId");
    expect(seen.form).not.toHaveProperty("baseRate");
    expect((await listEmployees(limited))[0]!.baseRate).toBeNull();
    await expect(saveEmployee(limited, id, { ...seen.form, baseRate: "99999" })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await saveEmployee(limited, id, { ...seen.form, designation: "Head cook" });
    expect((await db.employee.findUniqueOrThrow({ where: { id } })).baseRate.toString()).toBe("30000");
    await expect(employee(cashier)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("links a login to one employee only", async () => {
    const u = await createUserWithRole("kitchen");
    await employee(owner, { userId: u.id });
    await expect(employee(owner, { fullName: "Second", userId: u.id })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("attendance", () => {
  it("records manual attendance with late, worked and overtime minutes, across midnight", async () => {
    const shift = await saveWorkShift(owner, null, { name: "Evening", start: "16:00", end: "02:00", graceMinutes: 10, breakMinutes: 30 });
    const { id } = await employee(owner, { workShiftId: shift.id });
    const r = await saveAttendance(manager, { employeeId: id, workDate: lastMonth.start, status: "PRESENT", checkIn: "16:20", checkOut: "03:20" });
    expect(r.status).toBe("LATE");
    expect(r.lateMinutes).toBe(20);
    expect(r.workedMinutes).toBe(630);
    expect(r.overtimeMinutes).toBe(60);
    await expect(saveAttendance(cashier, { employeeId: id, workDate: lastMonth.start, status: "ABSENT" })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(saveAttendance(manager, { employeeId: id, workDate: "2999-01-01", status: "ABSENT" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("lets a linked staff member check in and out once, using the server clock", async () => {
    const u = await createUserWithRole("cashier");
    const me = await ctxFor(u.id);
    await expect(clock(me, "IN")).rejects.toMatchObject({ code: "INVALID_STATE" });
    const shift = await saveWorkShift(owner, null, { name: "Day", start: "11:00", end: "19:00", graceMinutes: 10, breakMinutes: 0 });
    await employee(owner, { userId: u.id, workShiftId: shift.id });
    const at = localInstant(today, 11 * 60 + 30, "Asia/Karachi");
    const r = await clock(me, "IN", at);
    expect(r).toMatchObject({ state: "IN", status: "LATE", lateMinutes: 30 });
    await expect(clock(me, "IN", at)).rejects.toMatchObject({ code: "CONFLICT" });
    const out = await clock(me, "OUT", new Date(at.getTime() + 8 * 3_600_000));
    expect(out.workedMinutes).toBe(480);
    const view = await myClock(me);
    expect(view.linked && view.state).toBe("DONE");
    const row = await db.attendance.findFirstOrThrow({ where: { employee: { userId: u.id } } });
    expect(row.source).toBe("SELF");
  });

  it("marks everyone present in one go without overwriting entries", async () => {
    const a = await employee(owner);
    const b = await employee(owner, { fullName: "Sara" });
    await saveAttendance(manager, { employeeId: a.id, workDate: today, status: "ABSENT" });
    const r = await markMany(manager, { workDate: today, status: "PRESENT", employeeIds: [a.id, b.id] });
    expect(r).toEqual({ marked: 1, skipped: 1 });
    const sheet = await attendanceSheet(manager, today);
    expect(sheet.totals).toMatchObject({ staff: 2, present: 1, absent: 1 });
  });
});

describe("payroll", () => {
  async function preparedRun() {
    const { id } = await employee(owner);
    await saveAttendance(manager, { employeeId: id, workDate: lastMonth.start, status: "ABSENT" });
    await issueAdvance(manager, { employeeId: id, amount: "4000", installment: "2500", issuedOn: lastMonth.start, paymentMethod: "CASH_DRAWER", terminalId });
    const run = await createPayrollRun(manager, { periodStart: lastMonth.start, periodEnd: lastMonth.end });
    return { employeeId: id, runId: run.id };
  }

  it("calculates payslips with absence and advance deductions", async () => {
    const { runId } = await preparedRun();
    const run = await getPayrollRun(manager, runId);
    expect(run.runNumber).toBe("PR-0001");
    const slip = run.payslips[0]!;
    expect(slip.lines.map((l) => [l.code, l.amount])).toEqual([
      ["BASIC", "30000.00"],
      ["ABSENCE", "1000.00"],
      ["ADVANCE", "2500.00"],
    ]);
    expect(slip.net).toBe("26500.00");
    expect(run.net).toBe("26500.00");
    // The advance was paid from the till as an expense.
    const adv = await db.expense.findFirstOrThrow({ where: { sourceType: "employee_advance" } });
    expect(adv.amount.toString()).toBe("4000");
    await expect(createPayrollRun(manager, { periodStart: lastMonth.start, periodEnd: lastMonth.end })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("keeps manual lines on recalculation, and only owners approve", async () => {
    const { runId } = await preparedRun();
    const slip = (await getPayrollRun(manager, runId)).payslips[0]!;
    await addManualLine(manager, slip.id, { kind: "EARNING", code: "BONUS", label: "Eid bonus", amount: "3000" });
    await recalculateRun(manager, runId);
    const after = (await getPayrollRun(manager, runId)).payslips[0]!;
    expect(after.net).toBe("29500.00");
    const run = await getPayrollRun(manager, runId);
    await expect(approveRun(manager, runId, run.version)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(approveRun(owner, runId, run.version - 1)).rejects.toMatchObject({ code: "CONFLICT" });
    await approveRun(owner, runId, run.version);
    await expect(addManualLine(manager, slip.id, { kind: "EARNING", code: "BONUS", label: "More", amount: "1" })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("freezes approved payroll and its attendance, even at the database level", async () => {
    const { runId, employeeId } = await preparedRun();
    const run = await getPayrollRun(owner, runId);
    await approveRun(owner, runId, run.version);
    await expect(saveAttendance(manager, { employeeId, workDate: lastMonth.start, status: "PRESENT" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(db.payslip.updateMany({ where: { payrollRunId: runId }, data: { net: 1 } })).rejects.toThrow(/cannot be changed/);
    await expect(db.attendance.updateMany({ where: { employeeId }, data: { status: "PRESENT" } })).rejects.toThrow(/locked/);
  });

  it("paying creates the salary expense, recovers the advance and closes the run", async () => {
    const { runId, employeeId } = await preparedRun();
    const run = await getPayrollRun(owner, runId);
    await approveRun(owner, runId, run.version);
    const slip = run.payslips[0]!;
    await expect(payPayslip(manager, slip.id, { paymentMethod: "BANK_TRANSFER", paidOn: today })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    const r = await payPayslip(owner, slip.id, { paymentMethod: "BANK_TRANSFER", paidOn: today, reference: "IBFT 991" });
    expect(r.runPaid).toBe(true);
    await expect(payPayslip(owner, slip.id, { paymentMethod: "BANK_TRANSFER", paidOn: today })).rejects.toMatchObject({ code: "CONFLICT" });
    const ex = await db.expense.findFirstOrThrow({ where: { sourceType: "payslip", sourceId: slip.id }, include: { category: true } });
    expect(ex.amount.toString()).toBe("26500");
    expect(ex.category.systemKey).toBe("salaries");
    expect((await db.payrollRun.findUniqueOrThrow({ where: { id: runId } })).status).toBe("PAID");
    const [adv] = await employeeAdvances(owner, employeeId);
    expect(adv).toMatchObject({ recovered: "2500.00", balance: "1500.00", status: "OPEN" });
    await expect(voidExpense(owner, ex.id, "nope")).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("pays everyone from the till and blocks cancelling an advance in a run", async () => {
    const { runId, employeeId } = await preparedRun();
    await employee(owner, { fullName: "Sara", baseRate: "1000" });
    await recalculateRun(manager, runId);
    const [adv] = await employeeAdvances(owner, employeeId);
    await expect(cancelAdvance(manager, adv!.id, "mistake")).rejects.toMatchObject({ code: "INVALID_STATE" });
    const run = await getPayrollRun(owner, runId);
    expect(run.payslips).toHaveLength(2);
    await approveRun(owner, runId, run.version);
    await expect(payAll(owner, runId, { paymentMethod: "CASH_DRAWER", terminalId, paidOn: today })).rejects.toMatchObject({ code: "INVALID_STATE" }); // not enough cash
    await payAll(owner, runId, { paymentMethod: "BANK_TRANSFER", paidOn: today });
    expect(await db.expense.count({ where: { sourceType: "payslip" } })).toBe(2);
  });

  it("cancels an unused advance and returns the cash to the till", async () => {
    const { id } = await employee(owner);
    const a = await issueAdvance(manager, { employeeId: id, amount: "1000", issuedOn: today, paymentMethod: "CASH_DRAWER", terminalId });
    const shift = await db.cashShift.findFirstOrThrow({ where: { status: "OPEN" } });
    expect((await computeShiftSummary(shift.id)).expectedCash).toBe("4000.00");
    await cancelAdvance(manager, a.id, "Not needed");
    expect((await computeShiftSummary(shift.id)).expectedCash).toBe("5000.00");
  });
});
