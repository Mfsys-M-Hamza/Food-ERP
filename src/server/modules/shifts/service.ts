import "server-only";
import { z } from "zod";
import { db, withTransaction, Prisma, type Db } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";
import { authorize, can } from "@/server/core/rbac";
import { recordAudit } from "@/server/core/audit";
import { emit } from "@/server/core/events";
import { forbidden, invalidState, notFound, validationFailed, conflict } from "@/server/core/errors";
import { zodFieldErrors } from "@/server/core/action";
import { nextSequence, formatDocNumber } from "@/server/core/numbering";
import { getSetting } from "@/server/modules/settings/service";

const money = z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/, "Enter a valid amount");
const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);

export const openShiftSchema = z.object({ terminalId: z.uuid("Choose a till"), openingCash: money });
export const cashMovementSchema = z.object({
  shiftId: z.uuid(),
  type: z.enum(["PAY_IN", "PAY_OUT"]),
  amount: money.refine((v) => Number(v) > 0, "Amount must be more than zero"),
  reason: z.string().trim().min(3, "Give a reason").max(160),
});
export const closeShiftSchema = z.object({
  shiftId: z.uuid(),
  countedCash: money,
  denominations: z.record(z.string(), z.number().int().min(0).max(100000)).optional(),
  note: z.string().trim().max(300).optional().default(""),
});

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw validationFailed(zodFieldErrors(r.error));
  return r.data;
}

export async function listTerminals(ctx: Ctx) {
  if (ctx.user.kind !== "STAFF") throw forbidden();
  const rows = await db.posTerminal.findMany({
    where: { branchId: ctx.branchId, isActive: true, kind: "POS" },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return rows;
}

/** The open shift on a till, if any. */
export async function getOpenShift(terminalId: string, client: Db = db) {
  return client.cashShift.findFirst({ where: { terminalId, status: "OPEN" } });
}

export async function openShift(ctx: Ctx, input: unknown) {
  authorize(ctx, "shifts.own");
  const data = parse(openShiftSchema, input);
  return withTransaction(async (tx) => {
    const terminal = await tx.posTerminal.findFirst({ where: { id: data.terminalId, branchId: ctx.branchId, isActive: true } });
    if (!terminal) throw validationFailed({ terminalId: ["Unknown till"] });
    if (await getOpenShift(terminal.id, tx)) throw conflict(`A shift is already open on ${terminal.name}.`);
    const n = await nextSequence(tx, ctx.branchId, "SHIFT", "ALL");
    const shift = await tx.cashShift.create({
      data: {
        branchId: ctx.branchId,
        terminalId: terminal.id,
        shiftNumber: formatDocNumber("SH", n),
        openedById: ctx.user.id,
        openingCash: data.openingCash,
      },
    });
    await recordAudit(tx, ctx, {
      action: "shift.open",
      module: "shifts",
      entityType: "cash_shift",
      entityId: shift.id,
      after: { terminal: terminal.name, openingCash: data.openingCash },
    });
    return shift;
  });
}

function assertCanOperate(ctx: Ctx, shift: { openedById: string }) {
  if (shift.openedById !== ctx.user.id && !can(ctx, "shifts.view_all")) {
    // Any cashier on the same till may ring sales into the open shift, but
    // only its owner or a manager may move cash or close it.
    throw forbidden("Only the cashier who opened this shift or a manager can do this.");
  }
}

export async function addCashMovement(ctx: Ctx, input: unknown) {
  authorize(ctx, "shifts.own");
  const data = parse(cashMovementSchema, input);
  return withTransaction(async (tx) => {
    const shift = await tx.cashShift.findUnique({ where: { id: data.shiftId } });
    if (!shift || shift.branchId !== ctx.branchId) throw notFound("Shift");
    if (shift.status !== "OPEN") throw invalidState("This shift is closed.");
    assertCanOperate(ctx, shift);
    const amount = data.type === "PAY_IN" ? D(data.amount) : D(data.amount).negated();
    const txRow = await tx.cashTransaction.create({
      data: { cashShiftId: shift.id, type: data.type, amount, reason: data.reason, createdById: ctx.user.id },
    });
    await recordAudit(tx, ctx, {
      action: data.type === "PAY_IN" ? "shift.pay_in" : "shift.pay_out",
      module: "shifts",
      entityType: "cash_shift",
      entityId: shift.id,
      after: { amount: data.amount, reason: data.reason },
    });
    return txRow;
  });
}

export type ShiftSummary = {
  id: string;
  shiftNumber: string;
  terminalId: string;
  terminalName: string;
  status: "OPEN" | "CLOSED" | "APPROVED";
  openedBy: string;
  openedAt: Date;
  closedAt: Date | null;
  closedBy: string | null;
  approvedBy: string | null;
  openingCash: string;
  cashSales: string;
  cardSales: string;
  onlineSales: string;
  cashRefunds: string;
  payIns: string;
  payOuts: string;
  expenses: string;
  riderSettlements: string;
  supplierPayments: string;
  adjustments: string;
  expectedCash: string;
  countedCash: string | null;
  difference: string | null;
  orderCount: number;
  closingNote: string | null;
  denominations: Record<string, number> | null;
};

/** Expected cash = opening cash + every signed cash movement recorded in the shift. */
export async function computeShiftSummary(shiftId: string, client: Db = db): Promise<ShiftSummary> {
  const shift = await client.cashShift.findUnique({
    where: { id: shiftId },
    include: { terminal: { select: { name: true } }, openedBy: { select: { name: true } } },
  });
  if (!shift) throw notFound("Shift");
  // Sequential on purpose: a transaction client must not run queries in parallel.
  const byType = await client.cashTransaction.groupBy({ by: ["type"], where: { cashShiftId: shiftId }, _sum: { amount: true } });
  const byMethod = await client.payment.groupBy({ by: ["method"], where: { cashShiftId: shiftId, status: "SUCCEEDED" }, _sum: { amount: true } });
  const orderCount = await client.order.count({ where: { cashShiftId: shiftId } });
  const users = await client.user.findMany({
    where: { id: { in: [shift.closedById, shift.approvedById].filter(Boolean) as string[] } },
    select: { id: true, name: true },
  });
  const t = (type: string) => byType.find((r) => r.type === type)?._sum.amount ?? D(0);
  const m = (method: string) => byMethod.find((r) => r.method === method)?._sum.amount ?? D(0);
  const movement = byType.reduce((a, r) => a.plus(r._sum.amount ?? 0), D(0));
  const expected = shift.openingCash.plus(movement);
  const name = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;
  return {
    id: shift.id,
    shiftNumber: shift.shiftNumber,
    terminalId: shift.terminalId,
    terminalName: shift.terminal.name,
    status: shift.status,
    openedBy: shift.openedBy.name,
    openedAt: shift.openedAt,
    closedAt: shift.closedAt,
    closedBy: name(shift.closedById),
    approvedBy: name(shift.approvedById),
    openingCash: shift.openingCash.toFixed(2),
    cashSales: t("SALE").toFixed(2),
    cardSales: m("CARD").toFixed(2),
    onlineSales: m("ONLINE").plus(m("WALLET")).toFixed(2),
    cashRefunds: t("REFUND").abs().toFixed(2),
    payIns: t("PAY_IN").toFixed(2),
    payOuts: t("PAY_OUT").abs().toFixed(2),
    expenses: t("EXPENSE").abs().toFixed(2),
    riderSettlements: t("RIDER_SETTLEMENT").toFixed(2),
    supplierPayments: t("SUPPLIER_PAYMENT").abs().toFixed(2),
    adjustments: t("ADJUSTMENT").toFixed(2),
    expectedCash: (shift.status === "OPEN" ? expected : shift.expectedCash ?? expected).toFixed(2),
    countedCash: shift.countedCash?.toFixed(2) ?? null,
    difference: shift.difference?.toFixed(2) ?? null,
    orderCount,
    closingNote: shift.closingNote,
    denominations: (shift.denominationBreakdown as Record<string, number> | null) ?? null,
  };
}

export async function getShiftSummary(ctx: Ctx, shiftId: string): Promise<ShiftSummary> {
  authorize(ctx, "shifts.own");
  const shift = await db.cashShift.findUnique({ where: { id: shiftId }, select: { openedById: true, branchId: true } });
  if (!shift || shift.branchId !== ctx.branchId) throw notFound("Shift");
  if (shift.openedById !== ctx.user.id && !can(ctx, "shifts.view_all")) throw forbidden();
  return computeShiftSummary(shiftId);
}

export async function closeShift(ctx: Ctx, input: unknown): Promise<ShiftSummary> {
  authorize(ctx, "shifts.own");
  const data = parse(closeShiftSchema, input);
  const pos = await getSetting("pos");
  const result = await withTransaction(async (tx) => {
    const shift = await tx.cashShift.findUnique({ where: { id: data.shiftId } });
    if (!shift || shift.branchId !== ctx.branchId) throw notFound("Shift");
    if (shift.status !== "OPEN") throw invalidState("This shift is already closed.");
    assertCanOperate(ctx, shift);
    const summary = await computeShiftSummary(shift.id, tx);
    const expected = D(summary.expectedCash);
    const counted = D(data.countedCash);
    const difference = counted.minus(expected);
    await tx.cashShift.update({
      where: { id: shift.id },
      data: {
        status: "CLOSED",
        closedById: ctx.user.id,
        closedAt: new Date(),
        expectedCash: expected,
        countedCash: counted,
        difference,
        denominationBreakdown: data.denominations ?? Prisma.JsonNull,
        closingNote: data.note || null,
      },
    });
    const outOfTolerance = difference.abs().greaterThan(D(pos.cashDiscrepancyTolerance));
    await recordAudit(tx, ctx, {
      action: "shift.close",
      module: "shifts",
      entityType: "cash_shift",
      entityId: shift.id,
      after: { expected: expected.toFixed(2), counted: counted.toFixed(2), difference: difference.toFixed(2) },
      reason: data.note || undefined,
    });
    await emit(tx, { type: "shift.closed", shiftId: shift.id, branchId: shift.branchId, difference: difference.toFixed(2), outOfTolerance });
    return shift.id;
  });
  return computeShiftSummary(result);
}

export async function approveShift(ctx: Ctx, shiftId: string, note?: string): Promise<void> {
  authorize(ctx, "shifts.approve");
  await withTransaction(async (tx) => {
    const shift = await tx.cashShift.findUnique({ where: { id: shiftId } });
    if (!shift || shift.branchId !== ctx.branchId) throw notFound("Shift");
    if (shift.status !== "CLOSED") throw invalidState("Only closed shifts can be approved.");
    await tx.cashShift.update({ where: { id: shiftId }, data: { status: "APPROVED", approvedById: ctx.user.id, approvedAt: new Date() } });
    await recordAudit(tx, ctx, {
      action: "shift.approve",
      module: "shifts",
      entityType: "cash_shift",
      entityId: shiftId,
      after: { difference: shift.difference?.toFixed(2) },
      reason: note,
    });
  });
}

export type ShiftListRow = {
  id: string;
  shiftNumber: string;
  terminalName: string;
  openedBy: string;
  openedAt: Date;
  closedAt: Date | null;
  status: "OPEN" | "CLOSED" | "APPROVED";
  openingCash: string;
  expectedCash: string | null;
  countedCash: string | null;
  difference: string | null;
};

export async function listShifts(ctx: Ctx, opts: { status?: string; limit?: number } = {}): Promise<ShiftListRow[]> {
  authorize(ctx, "shifts.own");
  const rows = await db.cashShift.findMany({
    where: {
      branchId: ctx.branchId,
      ...(can(ctx, "shifts.view_all") ? {} : { openedById: ctx.user.id }),
      ...(opts.status && ["OPEN", "CLOSED", "APPROVED"].includes(opts.status) ? { status: opts.status as "OPEN" } : {}),
    },
    orderBy: { openedAt: "desc" },
    take: Math.min(opts.limit ?? 100, 500),
    include: { terminal: { select: { name: true } }, openedBy: { select: { name: true } } },
  });
  return rows.map((s) => ({
    id: s.id,
    shiftNumber: s.shiftNumber,
    terminalName: s.terminal.name,
    openedBy: s.openedBy.name,
    openedAt: s.openedAt,
    closedAt: s.closedAt,
    status: s.status,
    openingCash: s.openingCash.toFixed(2),
    expectedCash: s.expectedCash?.toFixed(2) ?? null,
    countedCash: s.countedCash?.toFixed(2) ?? null,
    difference: s.difference?.toFixed(2) ?? null,
  }));
}

export async function listShiftTransactions(ctx: Ctx, shiftId: string) {
  await getShiftSummary(ctx, shiftId);
  const rows = await db.cashTransaction.findMany({ where: { cashShiftId: shiftId }, orderBy: { createdAt: "asc" } });
  const users = await db.user.findMany({
    where: { id: { in: rows.map((r) => r.createdById).filter(Boolean) as string[] } },
    select: { id: true, name: true },
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    amount: r.amount.toFixed(2),
    reason: r.reason,
    referenceType: r.referenceType,
    referenceId: r.referenceId,
    createdAt: r.createdAt,
    createdBy: users.find((u) => u.id === r.createdById)?.name ?? "—",
  }));
}
