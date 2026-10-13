"use server";

import { refresh } from "next/cache";
import { requireContext } from "@/server/core/context";
import { runAction, type ActionResult } from "@/server/core/action";
import { saveEmployee, saveWorkShift } from "./employees";
import { saveAttendance, markMany, clock } from "./attendance";
import {
  issueAdvance,
  cancelAdvance,
  createPayrollRun,
  recalculateRun,
  addManualLine,
  removeManualLine,
  cancelRun,
  approveRun,
  payPayslip,
  payAll,
} from "./payroll";

const done = <T,>(fn: () => Promise<T>, message?: string) =>
  runAction(async () => {
    const r = await fn();
    refresh();
    return r;
  }, message);

export async function saveEmployeeAction(id: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  return done(async () => saveEmployee(await requireContext(), id ? String(id) : null, input), "Employee saved");
}

export async function saveWorkShiftAction(id: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  return done(async () => saveWorkShift(await requireContext(), id ? String(id) : null, input), "Shift saved");
}

export async function saveAttendanceAction(input: unknown) {
  return done(async () => saveAttendance(await requireContext(), input), "Attendance saved");
}

export async function markManyAction(input: unknown) {
  return done(async () => markMany(await requireContext(), input));
}

export async function clockAction(action: "IN" | "OUT") {
  return done(async () => clock(await requireContext(), action), action === "IN" ? "Checked in" : "Checked out");
}

export async function issueAdvanceAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return done(async () => issueAdvance(await requireContext(), input), "Advance recorded");
}

export async function cancelAdvanceAction(id: string, reason: string): Promise<ActionResult<undefined>> {
  return done(async () => {
    await cancelAdvance(await requireContext(), String(id), reason);
    return undefined;
  }, "Advance cancelled");
}

export async function createPayrollRunAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => createPayrollRun(await requireContext(), input), "Payroll prepared");
}

export async function recalculateRunAction(id: string): Promise<ActionResult<undefined>> {
  return done(async () => {
    await recalculateRun(await requireContext(), String(id));
    return undefined;
  }, "Payroll recalculated");
}

export async function addManualLineAction(payslipId: string, input: unknown): Promise<ActionResult<undefined>> {
  return done(async () => {
    await addManualLine(await requireContext(), String(payslipId), input);
    return undefined;
  }, "Line added");
}

export async function removeManualLineAction(lineId: string): Promise<ActionResult<undefined>> {
  return done(async () => {
    await removeManualLine(await requireContext(), String(lineId));
    return undefined;
  }, "Line removed");
}

export async function cancelRunAction(id: string): Promise<ActionResult<undefined>> {
  return done(async () => {
    await cancelRun(await requireContext(), String(id));
    return undefined;
  }, "Payroll cancelled");
}

export async function approveRunAction(id: string, version: number): Promise<ActionResult<undefined>> {
  return done(async () => {
    await approveRun(await requireContext(), String(id), Number(version));
    return undefined;
  }, "Payroll approved");
}

export async function payPayslipAction(id: string, input: unknown): Promise<ActionResult<{ runPaid: boolean }>> {
  return done(async () => payPayslip(await requireContext(), String(id), input), "Salary paid");
}

export async function payAllAction(runId: string, input: unknown): Promise<ActionResult<{ paid: number }>> {
  return done(async () => payAll(await requireContext(), String(runId), input), "Salaries paid");
}
