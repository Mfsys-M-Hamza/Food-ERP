import "server-only";
import { z } from "zod";
import { db, withTransaction, Prisma } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";
import { authorize, authorizeAny } from "@/server/core/rbac";
import { recordAudit, diffObjects } from "@/server/core/audit";
import { invalidState, notFound, validationFailed } from "@/server/core/errors";
import { zodFieldErrors } from "@/server/core/action";
import { nextSequence, formatDocNumber } from "@/server/core/numbering";
import { getSetting } from "@/server/modules/settings/service";
import { getOpenShift } from "@/server/modules/shifts/service";
import { normalizePhone } from "@/lib/phone";
import { unitOptions, toBase } from "@/lib/units";
import { postMovement, recomputeMenuCosts } from "@/server/modules/inventory/ledger";

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);
const money = z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/, "Enter an amount");

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw validationFailed(zodFieldErrors(r.error));
  return r.data;
}

// ═══ Suppliers ══════════════════════════════════════════════════════════════

export const supplierSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(80),
  contactPerson: z.string().trim().max(80).optional().default(""),
  phone: z.string().trim().max(20).refine((v) => !v || normalizePhone(v), "Enter a valid phone").optional().default(""),
  whatsapp: z.string().trim().max(20).refine((v) => !v || normalizePhone(v), "Enter a valid number").optional().default(""),
  email: z.union([z.email(), z.literal("")]).optional().default(""),
  address: z.string().trim().max(300).optional().default(""),
  taxNumber: z.string().trim().max(40).optional().default(""),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).default(0),
  notes: z.string().trim().max(500).optional().default(""),
  isActive: z.boolean().default(true),
  ingredientIds: z.array(z.uuid()).max(200).default([]),
});

export type SupplierRow = {
  id: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  whatsapp: string | null;
  isActive: boolean;
  purchasesTotal: string;
  paidTotal: string;
  outstanding: string;
  lastPurchaseAt: Date | null;
  ingredientCount: number;
};

async function balances(supplierIds: string[]) {
  const [purchases, payments] = await Promise.all([
    db.purchase.groupBy({ by: ["supplierId"], where: { supplierId: { in: supplierIds }, status: "RECEIVED" }, _sum: { total: true }, _max: { invoiceDate: true } }),
    db.supplierPayment.groupBy({ by: ["supplierId"], where: { supplierId: { in: supplierIds } }, _sum: { amount: true } }),
  ]);
  return (id: string) => {
    const p = purchases.find((x) => x.supplierId === id);
    const pay = payments.find((x) => x.supplierId === id);
    const total = p?._sum.total ?? D(0);
    const paid = pay?._sum.amount ?? D(0);
    return { total, paid, outstanding: total.minus(paid), last: p?._max.invoiceDate ?? null };
  };
}

export async function listSuppliers(ctx: Ctx, f: { q?: string } = {}): Promise<SupplierRow[]> {
  authorizeAny(ctx, ["suppliers.manage", "purchases.manage", "purchases.pay"]);
  const q = f.q?.trim();
  const rows = await db.supplier.findMany({
    where: { deletedAt: null, ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { contactPerson: { contains: q, mode: "insensitive" } }] } : {}) },
    orderBy: { name: "asc" },
    include: { _count: { select: { ingredients: true } } },
  });
  const bal = await balances(rows.map((r) => r.id));
  return rows.map((s) => {
    const b = bal(s.id);
    return {
      id: s.id,
      name: s.name,
      contactPerson: s.contactPerson,
      phone: s.phone,
      whatsapp: s.whatsapp,
      isActive: s.isActive,
      purchasesTotal: b.total.toFixed(2),
      paidTotal: b.paid.toFixed(2),
      outstanding: b.outstanding.toFixed(2),
      lastPurchaseAt: b.last,
      ingredientCount: s._count.ingredients,
    };
  });
}

export async function getSupplier(ctx: Ctx, id: string) {
  authorizeAny(ctx, ["suppliers.manage", "purchases.manage", "purchases.pay"]);
  const s = await db.supplier.findFirst({
    where: { id, deletedAt: null },
    include: { ingredients: { include: { ingredient: { select: { id: true, name: true, baseUnit: true } } } } },
  });
  if (!s) throw notFound("Supplier");
  const [b, purchases, payments] = await Promise.all([
    balances([id]).then((f) => f(id)),
    db.purchase.findMany({ where: { supplierId: id }, orderBy: { invoiceDate: "desc" }, take: 100 }),
    db.supplierPayment.findMany({ where: { supplierId: id }, orderBy: { paidAt: "desc" }, take: 100 }),
  ]);
  return {
    supplier: {
      id: s.id,
      name: s.name,
      contactPerson: s.contactPerson ?? "",
      phone: s.phone ?? "",
      whatsapp: s.whatsapp ?? "",
      email: s.email ?? "",
      address: s.address ?? "",
      taxNumber: s.taxNumber ?? "",
      paymentTermsDays: s.paymentTermsDays,
      notes: s.notes ?? "",
      isActive: s.isActive,
      ingredientIds: s.ingredients.map((i) => i.ingredientId),
    },
    ingredients: s.ingredients.map((i) => ({ id: i.ingredient.id, name: i.ingredient.name, baseUnit: i.ingredient.baseUnit, lastUnitCost: i.lastUnitCost?.toString() ?? null, lastPurchasedAt: i.lastPurchasedAt })),
    balance: { total: b.total.toFixed(2), paid: b.paid.toFixed(2), outstanding: b.outstanding.toFixed(2) },
    purchases: purchases.map((p) => ({ id: p.id, purchaseNumber: p.purchaseNumber, invoiceNo: p.supplierInvoiceNo, invoiceDate: p.invoiceDate, status: p.status, paymentStatus: p.paymentStatus, total: p.total.toFixed(2), amountPaid: p.amountPaid.toFixed(2) })),
    payments: payments.map((p) => ({ id: p.id, amount: p.amount.toFixed(2), method: p.method, reference: p.reference, paidAt: p.paidAt, purchaseId: p.purchaseId })),
  };
}

export async function saveSupplier(ctx: Ctx, id: string | null, input: unknown): Promise<{ id: string }> {
  authorize(ctx, "suppliers.manage");
  const d = parse(supplierSchema, input);
  return withTransaction(async (tx) => {
    const clash = await tx.supplier.findFirst({ where: { deletedAt: null, name: { equals: d.name, mode: "insensitive" }, ...(id ? { id: { not: id } } : {}) } });
    if (clash) throw validationFailed({ name: ["A supplier with this name already exists"] });
    const values = {
      name: d.name,
      contactPerson: d.contactPerson || null,
      phone: d.phone ? normalizePhone(d.phone) : null,
      whatsapp: d.whatsapp ? normalizePhone(d.whatsapp) : null,
      email: d.email || null,
      address: d.address || null,
      taxNumber: d.taxNumber || null,
      paymentTermsDays: d.paymentTermsDays,
      notes: d.notes || null,
      isActive: d.isActive,
    };
    let supplierId = id;
    if (id) {
      const before = await tx.supplier.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw notFound("Supplier");
      await tx.supplier.update({ where: { id }, data: values });
      const diff = diffObjects({ name: before.name, phone: before.phone, isActive: before.isActive }, { name: values.name, phone: values.phone, isActive: values.isActive });
      if (Object.keys(diff.after).length) await recordAudit(tx, ctx, { action: "supplier.update", module: "suppliers", entityType: "supplier", entityId: id, ...diff });
    } else {
      supplierId = (await tx.supplier.create({ data: values })).id;
      await recordAudit(tx, ctx, { action: "supplier.create", module: "suppliers", entityType: "supplier", entityId: supplierId, after: { name: d.name } });
    }
    const existing = await tx.supplierIngredient.findMany({ where: { supplierId: supplierId! } });
    const keep = new Set(d.ingredientIds);
    await tx.supplierIngredient.deleteMany({ where: { supplierId: supplierId!, ingredientId: { notIn: d.ingredientIds } } });
    for (const ingredientId of keep) {
      if (!existing.some((e) => e.ingredientId === ingredientId)) await tx.supplierIngredient.create({ data: { supplierId: supplierId!, ingredientId } });
    }
    return { id: supplierId! };
  });
}

// ═══ Purchases ══════════════════════════════════════════════════════════════

export const purchaseSchema = z.object({
  supplierId: z.uuid("Choose a supplier"),
  supplierInvoiceNo: z.string().trim().max(40).optional().default(""),
  invoiceDate: z.iso.date("Enter the invoice date"),
  dueDate: z.union([z.iso.date(), z.literal("")]).optional().default(""),
  discount: money.default("0"),
  tax: money.default("0"),
  notes: z.string().trim().max(500).optional().default(""),
  attachmentUrl: z.string().trim().max(500).optional().default(""),
  items: z
    .array(
      z.object({
        ingredientId: z.uuid(),
        quantity: z.string().trim().regex(/^\d{1,7}(\.\d{1,3})?$/, "Enter a quantity").refine((v) => Number(v) > 0, "Must be more than zero"),
        unit: z.string().trim().min(1),
        unitCost: z.string().trim().regex(/^\d{1,9}(\.\d{1,4})?$/, "Enter a cost"),
      }),
    )
    .min(1, "Add at least one item")
    .max(100),
});

async function buildLines(items: z.output<typeof purchaseSchema>["items"]) {
  const ingredients = await db.ingredient.findMany({ where: { id: { in: items.map((i) => i.ingredientId) }, deletedAt: null }, include: { units: true } });
  return items.map((it, idx) => {
    const ing = ingredients.find((x) => x.id === it.ingredientId);
    if (!ing) throw validationFailed({ [`items.${idx}.ingredientId`]: ["Unknown ingredient"] });
    const options = unitOptions(ing.baseUnit, ing.units.map((u) => ({ unit: u.unit, factor: u.factorToBase.toString() })));
    const opt = options.find((o) => o.unit === it.unit);
    if (!opt) throw validationFailed({ [`items.${idx}.unit`]: ["Unknown unit"] });
    const base = D(toBase(it.quantity, it.unit, options).toString());
    return {
      ingredientId: it.ingredientId,
      quantity: D(it.quantity),
      unit: it.unit,
      factorToBase: D(opt.factor),
      baseQuantity: base,
      unitCost: D(it.unitCost),
      lineTotal: D(it.quantity).times(it.unitCost).toDecimalPlaces(2),
    };
  });
}

function totals(lines: { lineTotal: Prisma.Decimal }[], discount: string, tax: string) {
  const subtotal = lines.reduce((s, l) => s.plus(l.lineTotal), D(0));
  const total = subtotal.minus(discount).plus(tax);
  if (total.isNegative()) throw validationFailed({ discount: ["Discount is more than the invoice"] });
  return { subtotal, total };
}

export async function savePurchaseDraft(ctx: Ctx, id: string | null, input: unknown): Promise<{ id: string }> {
  authorize(ctx, "purchases.manage");
  const d = parse(purchaseSchema, input);
  const lines = await buildLines(d.items);
  const { subtotal, total } = totals(lines, d.discount, d.tax);
  return withTransaction(async (tx) => {
    const supplier = await tx.supplier.findFirst({ where: { id: d.supplierId, deletedAt: null } });
    if (!supplier) throw validationFailed({ supplierId: ["Unknown supplier"] });
    if (d.supplierInvoiceNo) {
      const dup = await tx.purchase.findFirst({ where: { supplierId: d.supplierId, supplierInvoiceNo: d.supplierInvoiceNo, ...(id ? { id: { not: id } } : {}) } });
      if (dup) throw validationFailed({ supplierInvoiceNo: [`Invoice already entered as ${dup.purchaseNumber}`] });
    }
    const due = d.dueDate || (supplier.paymentTermsDays ? new Date(new Date(d.invoiceDate).getTime() + supplier.paymentTermsDays * 86_400_000).toISOString().slice(0, 10) : "");
    const values = {
      supplierId: d.supplierId,
      supplierInvoiceNo: d.supplierInvoiceNo || null,
      invoiceDate: new Date(`${d.invoiceDate}T00:00:00Z`),
      dueDate: due ? new Date(`${due}T00:00:00Z`) : null,
      discount: d.discount,
      tax: d.tax,
      subtotal,
      total,
      notes: d.notes || null,
      attachmentUrl: d.attachmentUrl || null,
    };
    let purchaseId = id;
    if (id) {
      const p = await tx.purchase.findFirst({ where: { id, branchId: ctx.branchId } });
      if (!p) throw notFound("Purchase");
      if (p.status !== "DRAFT") throw invalidState("Received purchases cannot be edited. Use a stock adjustment to correct stock.");
      await tx.purchase.update({ where: { id }, data: values });
      await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
    } else {
      const prefix = (await getSetting("numbering", tx)).purchasePrefix;
      const number = formatDocNumber(prefix, await nextSequence(tx, ctx.branchId, "PURCHASE", "ALL"));
      purchaseId = (await tx.purchase.create({ data: { ...values, branchId: ctx.branchId, purchaseNumber: number, createdById: ctx.user.id } })).id;
      await recordAudit(tx, ctx, { action: "purchase.create", module: "purchases", entityType: "purchase", entityId: purchaseId, after: { number, total: total.toFixed(2) } });
    }
    await tx.purchaseItem.createMany({ data: lines.map((l) => ({ ...l, purchaseId: purchaseId! })) });
    return { id: purchaseId! };
  });
}

/** Receive goods: stock goes up, average costs and menu food costs update. */
export async function receivePurchase(ctx: Ctx, id: string) {
  authorize(ctx, "purchases.manage");
  await withTransaction(async (tx) => {
    const p = await tx.purchase.findFirst({ where: { id, branchId: ctx.branchId }, include: { items: true } });
    if (!p) throw notFound("Purchase");
    if (p.status !== "DRAFT") throw invalidState("This purchase was already received or cancelled.");
    // Spread invoice discount / tax proportionally into the landed cost.
    const factor = p.subtotal.isZero() ? D(1) : p.total.dividedBy(p.subtotal);
    for (const item of p.items) {
      const landedPerBase = item.lineTotal.times(factor).dividedBy(item.baseQuantity);
      await postMovement(tx, {
        branchId: ctx.branchId,
        ingredientId: item.ingredientId,
        type: "PURCHASE",
        quantity: item.baseQuantity,
        unitCost: landedPerBase,
        referenceType: "purchase",
        referenceId: p.id,
        reason: `Purchase ${p.purchaseNumber}`,
        userId: ctx.user.id,
      });
      await tx.supplierIngredient.upsert({
        where: { supplierId_ingredientId: { supplierId: p.supplierId, ingredientId: item.ingredientId } },
        create: { supplierId: p.supplierId, ingredientId: item.ingredientId, lastUnitCost: landedPerBase.toDecimalPlaces(4), lastPurchasedAt: new Date() },
        update: { lastUnitCost: landedPerBase.toDecimalPlaces(4), lastPurchasedAt: new Date() },
      });
    }
    await tx.purchase.update({ where: { id }, data: { status: "RECEIVED", receivedAt: new Date(), receivedById: ctx.user.id } });
    await recomputeMenuCosts(tx, p.items.map((i) => i.ingredientId));
    await recordAudit(tx, ctx, { action: "purchase.receive", module: "purchases", entityType: "purchase", entityId: id, after: { number: p.purchaseNumber, total: p.total.toFixed(2), lines: p.items.length } });
  });
}

export async function cancelPurchase(ctx: Ctx, id: string, reason: string) {
  authorize(ctx, "purchases.manage");
  await withTransaction(async (tx) => {
    const p = await tx.purchase.findFirst({ where: { id, branchId: ctx.branchId } });
    if (!p) throw notFound("Purchase");
    if (p.status !== "DRAFT") throw invalidState("Only drafts can be cancelled.");
    await tx.purchase.update({ where: { id }, data: { status: "CANCELLED" } });
    await recordAudit(tx, ctx, { action: "purchase.cancel", module: "purchases", entityType: "purchase", entityId: id, reason });
  });
}

export async function listPurchases(ctx: Ctx, f: { status?: string; payment?: string; supplierId?: string; q?: string } = {}) {
  authorizeAny(ctx, ["purchases.manage", "purchases.pay"]);
  const rows = await db.purchase.findMany({
    where: {
      branchId: ctx.branchId,
      ...(f.status && f.status !== "all" ? { status: f.status as "DRAFT" } : {}),
      ...(f.payment && f.payment !== "all" ? { paymentStatus: f.payment as "UNPAID" } : {}),
      ...(f.supplierId ? { supplierId: f.supplierId } : {}),
      ...(f.q ? { OR: [{ purchaseNumber: { contains: f.q, mode: "insensitive" } }, { supplierInvoiceNo: { contains: f.q, mode: "insensitive" } }] } : {}),
    },
    orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
    take: 200,
    include: { supplier: { select: { name: true } }, _count: { select: { items: true } } },
  });
  return rows.map((p) => ({
    id: p.id,
    purchaseNumber: p.purchaseNumber,
    supplierName: p.supplier.name,
    invoiceNo: p.supplierInvoiceNo,
    invoiceDate: p.invoiceDate,
    dueDate: p.dueDate,
    status: p.status,
    paymentStatus: p.paymentStatus,
    total: p.total.toFixed(2),
    amountPaid: p.amountPaid.toFixed(2),
    items: p._count.items,
    overdue: p.status === "RECEIVED" && p.paymentStatus !== "PAID" && !!p.dueDate && p.dueDate < new Date(),
  }));
}

export async function getPurchase(ctx: Ctx, id: string) {
  authorizeAny(ctx, ["purchases.manage", "purchases.pay"]);
  const p = await db.purchase.findFirst({
    where: { id, branchId: ctx.branchId },
    include: {
      supplier: { select: { id: true, name: true } },
      items: { include: { ingredient: { select: { name: true, baseUnit: true } } } },
      payments: { orderBy: { paidAt: "asc" } },
    },
  });
  if (!p) throw notFound("Purchase");
  return {
    id: p.id,
    purchaseNumber: p.purchaseNumber,
    supplier: p.supplier,
    supplierInvoiceNo: p.supplierInvoiceNo ?? "",
    invoiceDate: p.invoiceDate.toISOString().slice(0, 10),
    dueDate: p.dueDate?.toISOString().slice(0, 10) ?? "",
    status: p.status,
    paymentStatus: p.paymentStatus,
    subtotal: p.subtotal.toFixed(2),
    discount: p.discount.toFixed(2),
    tax: p.tax.toFixed(2),
    total: p.total.toFixed(2),
    amountPaid: p.amountPaid.toFixed(2),
    balance: p.total.minus(p.amountPaid).toFixed(2),
    notes: p.notes ?? "",
    attachmentUrl: p.attachmentUrl ?? "",
    receivedAt: p.receivedAt,
    items: p.items.map((i) => ({
      ingredientId: i.ingredientId,
      name: i.ingredient.name,
      baseUnit: i.ingredient.baseUnit,
      quantity: i.quantity.toString(),
      unit: i.unit,
      unitCost: i.unitCost.toString(),
      lineTotal: i.lineTotal.toFixed(2),
    })),
    payments: p.payments.map((x) => ({ id: x.id, amount: x.amount.toFixed(2), method: x.method, reference: x.reference, paidAt: x.paidAt })),
  };
}

// ═══ Supplier payments ══════════════════════════════════════════════════════

export const supplierPaymentSchema = z.object({
  supplierId: z.uuid(),
  purchaseId: z.uuid().nullable().optional(),
  amount: money.refine((v) => Number(v) > 0, "Amount must be more than zero"),
  method: z.enum(["CASH_DRAWER", "CASH_OTHER", "BANK_TRANSFER", "CHEQUE", "CARD"]),
  reference: z.string().trim().max(80).optional().default(""),
  terminalId: z.uuid().nullable().optional(),
});

export async function paySupplier(ctx: Ctx, input: unknown) {
  authorize(ctx, "purchases.pay");
  const d = parse(supplierPaymentSchema, input);
  return withTransaction(async (tx) => {
    const supplier = await tx.supplier.findFirst({ where: { id: d.supplierId, deletedAt: null } });
    if (!supplier) throw notFound("Supplier");
    const amount = D(d.amount);
    let purchase = null as Awaited<ReturnType<typeof tx.purchase.findFirst>>;
    if (d.purchaseId) {
      purchase = await tx.purchase.findFirst({ where: { id: d.purchaseId, supplierId: d.supplierId, branchId: ctx.branchId } });
      if (!purchase) throw notFound("Purchase");
      if (purchase.status !== "RECEIVED") throw invalidState("Receive the purchase before paying it.");
      const due = purchase.total.minus(purchase.amountPaid);
      if (amount.greaterThan(due)) throw validationFailed({ amount: [`Only Rs ${due.toFixed(2)} is due on this invoice`] });
    }
    let shiftId: string | null = null;
    if (d.method === "CASH_DRAWER") {
      if (!d.terminalId) throw validationFailed({ terminalId: ["Choose the till the cash comes from"] });
      const shift = await getOpenShift(d.terminalId, tx);
      if (!shift) throw invalidState("Open a cash shift on that till first, or choose another payment method.");
      shiftId = shift.id;
    }
    const payment = await tx.supplierPayment.create({
      data: {
        branchId: ctx.branchId,
        supplierId: d.supplierId,
        purchaseId: d.purchaseId ?? null,
        amount,
        method: d.method,
        reference: d.reference || null,
        cashShiftId: shiftId,
        createdById: ctx.user.id,
      },
    });
    if (shiftId) {
      await tx.cashTransaction.create({
        data: { cashShiftId: shiftId, type: "SUPPLIER_PAYMENT", amount: amount.negated(), referenceType: "supplier_payment", referenceId: payment.id, reason: supplier.name, createdById: ctx.user.id },
      });
    }
    if (purchase) {
      const paid = purchase.amountPaid.plus(amount);
      await tx.purchase.update({
        where: { id: purchase.id },
        data: { amountPaid: paid, paymentStatus: paid.greaterThanOrEqualTo(purchase.total) ? "PAID" : "PARTIALLY_PAID" },
      });
    }
    await recordAudit(tx, ctx, {
      action: "supplier.payment",
      module: "purchases",
      entityType: "supplier",
      entityId: d.supplierId,
      after: { amount: amount.toFixed(2), method: d.method, purchaseId: d.purchaseId ?? null },
    });
    return { id: payment.id };
  });
}
