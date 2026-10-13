import "server-only";
import { z } from "zod";
import { db, withTransaction, Prisma, type Db } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";
import { authorize, authorizeAny, can } from "@/server/core/rbac";
import { recordAudit, diffObjects } from "@/server/core/audit";
import { forbidden, invalidState, notFound, validationFailed } from "@/server/core/errors";
import { zodFieldErrors } from "@/server/core/action";
import { nextSequence, formatDocNumber } from "@/server/core/numbering";
import { uploadPrivateDocument } from "@/server/core/storage";
import { todayFor, dayToDate, dateToDay } from "@/server/core/today";
import { getSetting } from "@/server/modules/settings/service";
import { computeShiftSummary, getOpenShift } from "@/server/modules/shifts/service";

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);

export const EXPENSE_METHODS = ["CASH_DRAWER", "CASH_OTHER", "BANK_TRANSFER", "CHEQUE", "CARD"] as const;
export type ExpenseMethod = (typeof EXPENSE_METHODS)[number];
export const EXPENSE_METHOD_LABEL: Record<ExpenseMethod, string> = {
  CASH_DRAWER: "Cash from till",
  CASH_OTHER: "Cash (office / owner)",
  BANK_TRANSFER: "Bank transfer",
  CHEQUE: "Cheque",
  CARD: "Card",
};

const amount = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,2})?$/, "Enter an amount")
  .refine((v) => Number(v) > 0, "Must be more than zero");

export const expenseSchema = z
  .object({
    categoryId: z.uuid("Choose a category"),
    amount,
    expenseDate: z.iso.date("Enter the date"),
    paymentMethod: z.enum(EXPENSE_METHODS),
    terminalId: z.uuid().optional().nullable(),
    payee: z.string().trim().max(120).optional().default(""),
    description: z.string().trim().min(2, "Describe the expense").max(300),
    reference: z.string().trim().max(80).optional().default(""),
  })
  .superRefine((v, c) => {
    if (v.paymentMethod === "CASH_DRAWER" && !v.terminalId) c.addIssue({ code: "custom", path: ["terminalId"], message: "Choose the till the cash comes from" });
  });
export type ExpenseInput = z.input<typeof expenseSchema>;

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw validationFailed(zodFieldErrors(r.error));
  return r.data;
}

// ═══ Creating (shared with payroll and advances) ════════════════════════════

export type NewExpense = {
  categoryId: string;
  amount: Prisma.Decimal;
  expenseDate: string;
  paymentMethod: ExpenseMethod;
  terminalId?: string | null;
  payee?: string | null;
  description: string;
  reference?: string | null;
  receiptFileId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
};

/**
 * Create an expense inside the caller's transaction. Cash from the till needs
 * an open shift on that till (the cashier's own unless they manage expenses)
 * and enough cash in it; a matching cash-drawer movement is recorded.
 */
export async function createExpenseInTx(tx: Db, ctx: Ctx, e: NewExpense) {
  const prefix = (await getSetting("numbering", tx)).expensePrefix;
  const expenseNumber = formatDocNumber(prefix, await nextSequence(tx, ctx.branchId, "EXPENSE", "ALL"));
  let shiftId: string | null = null;
  if (e.paymentMethod === "CASH_DRAWER") {
    if (!e.terminalId) throw validationFailed({ terminalId: ["Choose the till the cash comes from"] });
    const shift = await getOpenShift(e.terminalId, tx);
    if (!shift || shift.branchId !== ctx.branchId) throw invalidState("There is no open shift on that till. Open a shift or choose another payment method.");
    if (shift.openedById !== ctx.user.id && !can(ctx, "expenses.manage")) throw forbidden("You can only pay expenses from your own shift.");
    const summary = await computeShiftSummary(shift.id, tx);
    if (D(summary.expectedCash).lessThan(e.amount)) {
      throw invalidState(`Only Rs ${D(summary.expectedCash).toFixed(0)} should be in the till. Count the drawer or choose another payment method.`);
    }
    shiftId = shift.id;
  }
  const expense = await tx.expense.create({
    data: {
      branchId: ctx.branchId,
      expenseNumber,
      categoryId: e.categoryId,
      amount: e.amount,
      expenseDate: dayToDate(e.expenseDate),
      paymentMethod: e.paymentMethod,
      payee: e.payee || null,
      description: e.description,
      reference: e.reference || null,
      receiptFileId: e.receiptFileId ?? null,
      cashShiftId: shiftId,
      sourceType: e.sourceType ?? null,
      sourceId: e.sourceId ?? null,
      createdById: ctx.user.id,
    },
  });
  if (shiftId) {
    await tx.cashTransaction.create({
      data: {
        cashShiftId: shiftId,
        type: "EXPENSE",
        amount: e.amount.negated(),
        referenceType: "expense",
        referenceId: expense.id,
        reason: `${expenseNumber} ${e.description}`.slice(0, 200),
        createdById: ctx.user.id,
      },
    });
  }
  await recordAudit(tx, ctx, {
    action: "expense.create",
    module: "expenses",
    entityType: "expense",
    entityId: expense.id,
    after: { expenseNumber, amount: e.amount.toFixed(2), method: e.paymentMethod, categoryId: e.categoryId, source: e.sourceType ?? null },
  });
  return expense;
}

/** Void an expense inside the caller's transaction (used by payroll and advances too). */
export async function voidExpenseInTx(tx: Db, ctx: Ctx, expenseId: string, reason: string) {
  const ex = await tx.expense.findFirst({ where: { id: expenseId, branchId: ctx.branchId } });
  if (!ex) throw notFound("Expense");
  if (ex.status === "VOIDED") throw invalidState("This expense is already void.");
  if (ex.cashShiftId) {
    const shift = await tx.cashShift.findUnique({ where: { id: ex.cashShiftId } });
    if (shift?.status !== "OPEN") throw invalidState("The till shift for this cash expense is closed, so it can no longer be voided. Record a correction instead.");
    await tx.cashTransaction.create({
      data: { cashShiftId: shift.id, type: "EXPENSE", amount: ex.amount, referenceType: "expense", referenceId: ex.id, reason: `Void ${ex.expenseNumber}`, createdById: ctx.user.id },
    });
  }
  await tx.expense.update({ where: { id: ex.id }, data: { status: "VOIDED", voidedAt: new Date(), voidedById: ctx.user.id, voidReason: reason } });
  await recordAudit(tx, ctx, { action: "expense.void", module: "expenses", entityType: "expense", entityId: ex.id, before: { status: "ACTIVE" }, after: { status: "VOIDED" }, reason });
}

async function checkCategory(tx: Db, categoryId: string) {
  const cat = await tx.expenseCategory.findUnique({ where: { id: categoryId } });
  if (!cat || !cat.isActive) throw validationFailed({ categoryId: ["Choose a category"] });
  if (cat.systemKey) throw validationFailed({ categoryId: [`${cat.name} are recorded from payroll`] });
  return cat;
}

async function checkDate(tx: Db, ctx: Ctx, iso: string) {
  const today = await todayFor(ctx.branchId, tx);
  if (iso > today) throw validationFailed({ expenseDate: ["The date cannot be in the future"] });
}

// ═══ Staff-facing operations ═════════════════════════════════════════════════

export async function createExpense(ctx: Ctx, input: unknown, receipt?: File | null) {
  authorize(ctx, "expenses.create");
  const d = parse(expenseSchema, input);
  if (!can(ctx, "expenses.manage") && d.paymentMethod !== "CASH_DRAWER") {
    throw forbidden("You can record cash paid from your own till only.");
  }
  const receiptFileId = receipt && receipt.size > 0 ? (await uploadPrivateDocument(ctx, receipt, { folder: "expense-receipts" })).id : null;
  return withTransaction(async (tx) => {
    await checkCategory(tx, d.categoryId);
    await checkDate(tx, ctx, d.expenseDate);
    const ex = await createExpenseInTx(tx, ctx, { ...d, amount: D(d.amount), receiptFileId });
    return { id: ex.id, expenseNumber: ex.expenseNumber };
  });
}

export async function updateExpense(ctx: Ctx, id: string, input: unknown) {
  authorize(ctx, "expenses.manage");
  const d = parse(expenseSchema, input);
  return withTransaction(async (tx) => {
    const ex = await tx.expense.findFirst({ where: { id, branchId: ctx.branchId } });
    if (!ex) throw notFound("Expense");
    if (ex.status === "VOIDED") throw invalidState("A void expense cannot be edited.");
    if (ex.sourceType) throw invalidState("This expense was created by payroll. Change it there.");
    const moneyChanged = !ex.amount.equals(D(d.amount)) || ex.paymentMethod !== d.paymentMethod;
    if (moneyChanged && (ex.paymentMethod === "CASH_DRAWER" || d.paymentMethod === "CASH_DRAWER")) {
      throw invalidState("Cash taken from the till cannot be changed. Void this expense and record it again.");
    }
    await checkCategory(tx, d.categoryId);
    await checkDate(tx, ctx, d.expenseDate);
    const before = { categoryId: ex.categoryId, amount: ex.amount.toFixed(2), expenseDate: dateToDay(ex.expenseDate), paymentMethod: ex.paymentMethod, payee: ex.payee ?? "", description: ex.description, reference: ex.reference ?? "" };
    const after = { categoryId: d.categoryId, amount: D(d.amount).toFixed(2), expenseDate: d.expenseDate, paymentMethod: d.paymentMethod, payee: d.payee, description: d.description, reference: d.reference };
    await tx.expense.update({
      where: { id },
      data: { categoryId: d.categoryId, amount: D(d.amount), expenseDate: dayToDate(d.expenseDate), paymentMethod: d.paymentMethod, payee: d.payee || null, description: d.description, reference: d.reference || null },
    });
    await recordAudit(tx, ctx, { action: "expense.update", module: "expenses", entityType: "expense", entityId: id, ...diffObjects(before, after) });
    return { id };
  });
}

export async function voidExpense(ctx: Ctx, id: string, reason: unknown) {
  authorize(ctx, "expenses.manage");
  const r = z.string().trim().min(3, "Give a reason").max(200).safeParse(reason);
  if (!r.success) throw validationFailed({ reason: r.error.issues.map((i) => i.message) });
  return withTransaction(async (tx) => {
    const ex = await tx.expense.findFirst({ where: { id, branchId: ctx.branchId } });
    if (!ex) throw notFound("Expense");
    if (ex.sourceType === "payslip") throw invalidState("Salary payments are managed from payroll.");
    if (ex.sourceType === "employee_advance") throw invalidState("Cancel the advance from the employee's page instead.");
    await voidExpenseInTx(tx, ctx, id, r.data);
  });
}

export async function attachReceipt(ctx: Ctx, id: string, file: File) {
  authorizeAny(ctx, ["expenses.create", "expenses.manage"]);
  const ex = await db.expense.findFirst({ where: { id, branchId: ctx.branchId } });
  if (!ex) throw notFound("Expense");
  if (!can(ctx, "expenses.manage") && ex.createdById !== ctx.user.id) throw forbidden();
  const { id: fileId } = await uploadPrivateDocument(ctx, file, { folder: "expense-receipts" });
  await withTransaction(async (tx) => {
    await tx.expense.update({ where: { id }, data: { receiptFileId: fileId } });
    await recordAudit(tx, ctx, { action: "expense.receipt", module: "expenses", entityType: "expense", entityId: id, after: { receiptFileId: fileId } });
  });
}

/** Whether this user may download a private receipt file. */
export async function canReadReceipt(ctx: Ctx, fileId: string): Promise<boolean> {
  const ex = await db.expense.findFirst({ where: { receiptFileId: fileId, branchId: ctx.branchId }, select: { createdById: true } });
  if (!ex) return false;
  return can(ctx, "expenses.manage") || (can(ctx, "expenses.create") && ex.createdById === ctx.user.id);
}

// ═══ Reading ═════════════════════════════════════════════════════════════════

export const expenseFilterSchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  categoryId: z.uuid().optional(),
  method: z.enum(EXPENSE_METHODS).optional(),
  status: z.enum(["ACTIVE", "VOIDED"]).optional(),
  q: z.string().trim().max(80).optional(),
});

export type ExpenseRow = {
  id: string;
  expenseNumber: string;
  expenseDate: string;
  category: string;
  amount: string;
  paymentMethod: ExpenseMethod;
  payee: string | null;
  description: string;
  status: "ACTIVE" | "VOIDED";
  hasReceipt: boolean;
  createdBy: string | null;
  automatic: boolean;
};

export async function listExpenses(ctx: Ctx, filters: unknown) {
  authorizeAny(ctx, ["expenses.create", "expenses.manage"]);
  const f = expenseFilterSchema.parse(filters);
  const today = await todayFor(ctx.branchId);
  const from = f.from ?? `${today.slice(0, 8)}01`;
  const to = f.to ?? today;
  const where: Prisma.ExpenseWhereInput = {
    branchId: ctx.branchId,
    expenseDate: { gte: dayToDate(from), lte: dayToDate(to) },
    ...(f.categoryId ? { categoryId: f.categoryId } : {}),
    ...(f.method ? { paymentMethod: f.method } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.q
      ? { OR: [{ expenseNumber: { contains: f.q, mode: "insensitive" } }, { description: { contains: f.q, mode: "insensitive" } }, { payee: { contains: f.q, mode: "insensitive" } }] }
      : {}),
    // Cashiers see only what they recorded.
    ...(can(ctx, "expenses.manage") ? {} : { createdById: ctx.user.id }),
  };
  const rows = await db.expense.findMany({ where, orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }], take: 500, include: { category: { select: { name: true } } } });
  const userIds = [...new Set(rows.map((r) => r.createdById).filter((x): x is string => !!x))];
  const users = userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const byCategory = new Map<string, Prisma.Decimal>();
  let total = D(0);
  for (const r of rows) {
    if (r.status !== "ACTIVE") continue;
    total = total.plus(r.amount);
    byCategory.set(r.category.name, (byCategory.get(r.category.name) ?? D(0)).plus(r.amount));
  }
  return {
    from,
    to,
    total: total.toFixed(2),
    byCategory: [...byCategory.entries()].sort((a, b) => b[1].comparedTo(a[1])).map(([name, v]) => ({ name, total: v.toFixed(2) })),
    rows: rows.map(
      (r): ExpenseRow => ({
        id: r.id,
        expenseNumber: r.expenseNumber,
        expenseDate: dateToDay(r.expenseDate),
        category: r.category.name,
        amount: r.amount.toFixed(2),
        paymentMethod: r.paymentMethod,
        payee: r.payee,
        description: r.description,
        status: r.status,
        hasReceipt: !!r.receiptFileId,
        createdBy: users.find((u) => u.id === r.createdById)?.name ?? null,
        automatic: !!r.sourceType,
      }),
    ),
  };
}

export async function getExpense(ctx: Ctx, id: string) {
  authorizeAny(ctx, ["expenses.create", "expenses.manage"]);
  const r = await db.expense.findFirst({ where: { id, branchId: ctx.branchId }, include: { category: true, receipt: { select: { id: true, mimeType: true } } } });
  if (!r) throw notFound("Expense");
  if (!can(ctx, "expenses.manage") && r.createdById !== ctx.user.id) throw notFound("Expense");
  const [creator, voider, shift] = await Promise.all([
    r.createdById ? db.user.findUnique({ where: { id: r.createdById }, select: { name: true } }) : null,
    r.voidedById ? db.user.findUnique({ where: { id: r.voidedById }, select: { name: true } }) : null,
    r.cashShiftId ? db.cashShift.findUnique({ where: { id: r.cashShiftId }, select: { id: true, shiftNumber: true, terminalId: true, status: true, terminal: { select: { name: true } } } }) : null,
  ]);
  return {
    id: r.id,
    expenseNumber: r.expenseNumber,
    categoryId: r.categoryId,
    category: r.category.name,
    amount: r.amount.toFixed(2),
    expenseDate: dateToDay(r.expenseDate),
    paymentMethod: r.paymentMethod,
    terminalId: shift?.terminalId ?? null,
    payee: r.payee ?? "",
    description: r.description,
    reference: r.reference ?? "",
    receipt: r.receipt,
    shift: shift ? { id: shift.id, shiftNumber: shift.shiftNumber, terminal: shift.terminal.name, open: shift.status === "OPEN" } : null,
    status: r.status,
    voidReason: r.voidReason,
    voidedAt: r.voidedAt,
    voidedBy: voider?.name ?? null,
    createdBy: creator?.name ?? null,
    createdAt: r.createdAt,
    sourceType: r.sourceType,
    sourceId: r.sourceId,
  };
}

// ═══ Categories ══════════════════════════════════════════════════════════════

export async function listExpenseCategories(ctx: Ctx, opts: { includeInactive?: boolean; includeSystem?: boolean } = {}) {
  authorizeAny(ctx, ["expenses.create", "expenses.manage"]);
  const rows = await db.expenseCategory.findMany({
    where: { ...(opts.includeInactive ? {} : { isActive: true }), ...(opts.includeSystem ? {} : { systemKey: null }) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { expenses: true } } },
  });
  return rows.map((c) => ({ id: c.id, name: c.name, isActive: c.isActive, system: !!c.systemKey, expenseCount: c._count.expenses }));
}

const categorySchema = z.object({ name: z.string().trim().min(2, "Enter a name").max(60), isActive: z.boolean().default(true) });

export async function saveExpenseCategory(ctx: Ctx, id: string | null, input: unknown) {
  authorize(ctx, "expenses.manage");
  const d = parse(categorySchema, input);
  return withTransaction(async (tx) => {
    const clash = await tx.expenseCategory.findFirst({ where: { name: { equals: d.name, mode: "insensitive" }, ...(id ? { NOT: { id } } : {}) } });
    if (clash) throw validationFailed({ name: ["A category with this name already exists"] });
    if (id) {
      const c = await tx.expenseCategory.findUnique({ where: { id } });
      if (!c) throw notFound("Category");
      if (c.systemKey && !d.isActive) throw invalidState(`${c.name} is used by payroll and cannot be archived.`);
      await tx.expenseCategory.update({ where: { id }, data: d });
      await recordAudit(tx, ctx, { action: "expense_category.update", module: "expenses", entityType: "expense_category", entityId: id, ...diffObjects({ name: c.name, isActive: c.isActive }, d) });
      return { id };
    }
    const max = await tx.expenseCategory.aggregate({ _max: { sortOrder: true } });
    const c = await tx.expenseCategory.create({ data: { ...d, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
    await recordAudit(tx, ctx, { action: "expense_category.create", module: "expenses", entityType: "expense_category", entityId: c.id, after: d });
    return { id: c.id };
  });
}

export async function systemCategoryId(tx: Db, key: "salaries" | "salary_advances"): Promise<string> {
  const c = await tx.expenseCategory.findUnique({ where: { systemKey: key } });
  if (c) return c.id;
  const created = await tx.expenseCategory.create({ data: { name: key === "salaries" ? "Salaries" : "Salary advances", systemKey: key } });
  return created.id;
}

/** Tills with an open shift, for the "cash from till" choice. */
export async function drawerOptions(ctx: Ctx) {
  const shifts = await db.cashShift.findMany({
    where: { branchId: ctx.branchId, status: "OPEN", ...(can(ctx, "expenses.manage") ? {} : { openedById: ctx.user.id }) },
    include: { terminal: { select: { id: true, name: true } }, openedBy: { select: { name: true } } },
  });
  return shifts.map((s) => ({ terminalId: s.terminal.id, label: `${s.terminal.name} · ${s.openedBy.name}'s shift` }));
}
