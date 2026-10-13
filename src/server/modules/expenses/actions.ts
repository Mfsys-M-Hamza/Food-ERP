"use server";

import { refresh } from "next/cache";
import { requireContext } from "@/server/core/context";
import { runAction, type ActionResult } from "@/server/core/action";
import { validationFailed } from "@/server/core/errors";
import { createExpense, updateExpense, voidExpense, attachReceipt, saveExpenseCategory, listExpenseCategories, drawerOptions } from "./service";
import { todayFor } from "@/server/core/today";
import { can } from "@/server/core/rbac";

function fileFrom(form: FormData): File | null {
  const f = form.get("receipt");
  return f instanceof File && f.size > 0 ? f : null;
}

/** FormData: `data` (JSON of the expense) and an optional `receipt` file. */
export async function createExpenseAction(form: FormData): Promise<ActionResult<{ id: string; expenseNumber: string }>> {
  return runAction(async () => {
    const raw = form.get("data");
    if (typeof raw !== "string") throw validationFailed({ _form: ["Missing data"] });
    const r = await createExpense(await requireContext(), JSON.parse(raw) as unknown, fileFrom(form));
    refresh();
    return r;
  }, "Expense recorded");
}

export async function updateExpenseAction(id: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const r = await updateExpense(await requireContext(), String(id), input);
    refresh();
    return r;
  }, "Expense updated");
}

export async function voidExpenseAction(id: string, reason: string): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await voidExpense(await requireContext(), String(id), reason);
    refresh();
    return undefined;
  }, "Expense voided");
}

export async function attachReceiptAction(id: string, form: FormData): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const file = fileFrom(form);
    if (!file) throw validationFailed({ receipt: ["Choose a photo or PDF"] });
    await attachReceipt(await requireContext(), String(id), file);
    refresh();
    return undefined;
  }, "Receipt attached");
}

export async function saveExpenseCategoryAction(id: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const r = await saveExpenseCategory(await requireContext(), id ? String(id) : null, input);
    refresh();
    return r;
  }, "Category saved");
}

/** Choices for the POS expense form (categories, tills with open shifts). */
export async function expenseFormOptionsAction() {
  return runAction(async () => {
    const ctx = await requireContext();
    const [categories, tills, today] = await Promise.all([listExpenseCategories(ctx), drawerOptions(ctx), todayFor(ctx.branchId)]);
    return { categories: categories.map((c) => ({ id: c.id, name: c.name })), tills, today, canManage: can(ctx, "expenses.manage") };
  });
}
