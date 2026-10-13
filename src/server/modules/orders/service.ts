import "server-only";
import { randomBytes } from "node:crypto";
import type { z } from "zod";
import { db, withTransaction, Prisma, type Tx, type Db } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";
import { authorize, authorizeAny, can } from "@/server/core/rbac";
import { recordAudit } from "@/server/core/audit";
import { emit } from "@/server/core/events";
import { forbidden, invalidState, notFound, validationFailed, AppError } from "@/server/core/errors";
import { zodFieldErrors } from "@/server/core/action";
import { nextSequence, formatDocNumber } from "@/server/core/numbering";
import { authorizeOrOverride } from "@/server/core/override";
import { getSetting } from "@/server/modules/settings/service";
import { getOpenShift } from "@/server/modules/shifts/service";
import { findOrCreateCustomer } from "@/server/modules/customers/service";
import { priceOrder, taxRateFor, deliveryChargeFor } from "@/lib/orders/pricing";
import { businessDate, compactDate } from "@/lib/business-date";
import { normalizePhone } from "@/lib/phone";
import { resolveLines } from "./lines";
import { runStatusHooks } from "./hooks";
// Registers inventory deduction on status changes (Phase 6).
import "@/server/modules/inventory/deduction";
import "@/server/modules/marketing/hooks";
import { evaluateCoupon, redeemCoupon, type CouponQuote } from "@/server/modules/marketing/coupons";
import { redemptionFor, redeemForOrder, reverseForRefund, pointsFor } from "@/server/modules/marketing/loyalty";
import {
  canTransition,
  STATUS_TIMESTAMP,
  TRANSITION_PERMISSIONS,
  type OrderStatus,
} from "./state-machine";
import {
  createOrderSchema,
  addPaymentSchema,
  refundInputSchema,
  cancelInputSchema,
  type CreateOrderInput,
} from "./schemas";

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);
const STAFF_SOURCES = ["POS", "PHONE", "ADMIN", "AGGREGATOR"] as const;

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw validationFailed(zodFieldErrors(r.error));
  return r.data;
}

// ═══ Read models ════════════════════════════════════════════════════════════

const detailInclude = {
  items: { orderBy: { sortOrder: "asc" }, include: { addons: true, removals: true } },
  payments: { orderBy: { createdAt: "asc" } },
  refunds: { orderBy: { createdAt: "asc" } },
  discounts: true,
  delivery: { include: { zone: { select: { name: true } }, rider: { select: { id: true, name: true, phone: true } } } },
  statusHistory: { orderBy: { createdAt: "asc" } },
  customer: { select: { id: true, name: true, phone: true, isBlocked: true, totalOrders: true } },
  createdBy: { select: { name: true } },
} satisfies Prisma.OrderInclude;

type OrderWithDetail = Prisma.OrderGetPayload<{ include: typeof detailInclude }>;

export type OrderDetail = ReturnType<typeof toDetail>;

function toDetail(o: OrderWithDetail, names: Map<string, string>) {
  const balance = o.grandTotal.minus(o.amountPaid).plus(0);
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    displayNumber: o.displayNumber,
    businessDate: o.businessDate.toISOString().slice(0, 10),
    source: o.source,
    type: o.type,
    status: o.status as OrderStatus,
    paymentStatus: o.paymentStatus,
    customer: o.customer ? { id: o.customer.id, name: o.customer.name, phone: o.customer.phone, isBlocked: o.customer.isBlocked, totalOrders: o.customer.totalOrders } : null,
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    tableLabel: o.tableLabel,
    createdBy: o.createdBy?.name ?? null,
    createdAt: o.createdAt,
    items: o.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      variantId: i.variantId,
      productName: i.productName,
      variantName: i.variantName,
      quantity: i.quantity,
      unitPrice: i.unitPrice.toFixed(2),
      addonsUnitTotal: i.addonsUnitTotal.toFixed(2),
      lineTotal: i.lineTotal.toFixed(2),
      note: i.note,
      addons: i.addons.map((a) => ({ id: a.addonId, name: a.addonName, groupName: a.groupName, unitPrice: a.unitPrice.toFixed(2) })),
      removals: i.removals.map((r) => ({ id: r.removableOptionId, label: r.label })),
    })),
    subtotal: o.subtotal.toFixed(2),
    discountTotal: o.discountTotal.toFixed(2),
    serviceCharge: o.serviceCharge.toFixed(2),
    deliveryCharge: o.deliveryCharge.toFixed(2),
    taxTotal: o.taxTotal.toFixed(2),
    taxRate: o.taxRate.toNumber(),
    taxInclusive: o.taxInclusive,
    roundingAdjustment: o.roundingAdjustment.toFixed(2),
    grandTotal: o.grandTotal.toFixed(2),
    amountPaid: o.amountPaid.toFixed(2),
    amountRefunded: o.amountRefunded.toFixed(2),
    balanceDue: (balance.isNegative() ? D(0) : balance).toFixed(2),
    estimatedCostTotal: o.estimatedCostTotal.toFixed(2),
    payments: o.payments.map((p) => ({
      id: p.id,
      method: p.method,
      amount: p.amount.toFixed(2),
      tendered: p.tendered?.toFixed(2) ?? null,
      changeGiven: p.changeGiven?.toFixed(2) ?? null,
      status: p.status,
      createdAt: p.createdAt,
      receivedBy: names.get(p.receivedById ?? "") ?? null,
      reference: p.providerReference,
    })),
    refunds: o.refunds.map((r) => ({
      id: r.id,
      refundNumber: r.refundNumber,
      amount: r.amount.toFixed(2),
      method: r.method,
      reason: r.reason,
      createdAt: r.createdAt,
      by: names.get(r.requestedById ?? "") ?? null,
      approvedBy: names.get(r.approvedById ?? "") ?? null,
    })),
    discounts: o.discounts.map((d) => ({ kind: d.kind, amount: d.amount.toFixed(2), percent: d.percent?.toNumber() ?? null, reason: d.reason })),
    delivery: o.delivery
      ? {
          id: o.delivery.id,
          status: o.delivery.status,
          recipientName: o.delivery.recipientName,
          phone: o.delivery.phone,
          addressText: o.delivery.addressText,
          landmark: o.delivery.landmark,
          mapUrl: o.delivery.mapUrl,
          zoneName: o.delivery.zone?.name ?? null,
          rider: o.delivery.rider ? { id: o.delivery.rider.id, name: o.delivery.rider.name, phone: o.delivery.rider.phone } : null,
          codAmount: o.delivery.codAmount.toFixed(2),
          codCollectedAt: o.delivery.codCollectedAt,
          codSettledAt: o.delivery.codSettledAt,
          dispatchedAt: o.delivery.dispatchedAt,
          deliveredAt: o.delivery.deliveredAt,
          notes: o.delivery.notes,
        }
      : null,
    history: o.statusHistory.map((h) => ({
      from: h.fromStatus,
      to: h.toStatus,
      at: h.createdAt,
      by: names.get(h.changedById ?? "") ?? (h.source === "CUSTOMER" ? "Customer" : "System"),
      source: h.source,
      reason: h.reason,
    })),
    kitchenNote: o.kitchenNote,
    customerNote: o.customerNote,
    estimatedReadyAt: o.estimatedReadyAt,
    acceptedAt: o.acceptedAt,
    readyAt: o.readyAt,
    completedAt: o.completedAt,
    cancelledAt: o.cancelledAt,
    cancelReason: o.cancelReason,
    trackingToken: o.trackingToken,
    cashShiftId: o.cashShiftId,
    terminalId: o.terminalId,
    version: o.version,
  };
}

/** Internal: load an order detail without permission checks (callers check). */
export async function loadOrderDetail(id: string, client: Db = db) {
  const o = await client.order.findUnique({ where: { id }, include: detailInclude });
  if (!o) throw notFound("Order");
  const ids = new Set<string>();
  o.payments.forEach((p) => p.receivedById && ids.add(p.receivedById));
  o.refunds.forEach((r) => {
    if (r.requestedById) ids.add(r.requestedById);
    if (r.approvedById) ids.add(r.approvedById);
  });
  o.statusHistory.forEach((h) => h.changedById && ids.add(h.changedById));
  const users = ids.size ? await client.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } }) : [];
  return toDetail(o, new Map(users.map((u) => [u.id, u.name])));
}

export async function getOrder(ctx: Ctx, id: string) {
  authorizeAny(ctx, ["orders.view", "kitchen.view", "delivery.rider"]);
  const detail = await loadOrderDetail(id);
  if (!can(ctx, "orders.view") && !can(ctx, "kitchen.view")) {
    // Riders may only open their own deliveries.
    if (detail.delivery?.rider?.id !== ctx.user.id) throw forbidden();
  }
  return detail;
}

export type OrderListFilter = {
  q?: string;
  status?: string;
  type?: string;
  source?: string;
  payment?: string;
  from?: string;
  to?: string;
  page?: number;
  scope?: "active" | "today" | "all";
};

export type OrderListRow = {
  id: string;
  orderNumber: string;
  displayNumber: number;
  createdAt: Date;
  source: string;
  type: string;
  status: OrderStatus;
  paymentStatus: string;
  customerName: string | null;
  customerPhone: string | null;
  itemCount: number;
  grandTotal: string;
  amountPaid: string;
  createdBy: string | null;
  riderName: string | null;
};

export async function listOrders(ctx: Ctx, f: OrderListFilter = {}) {
  authorize(ctx, "orders.view");
  const pageSize = 50;
  const page = Math.max(1, f.page ?? 1);
  const where: Prisma.OrderWhereInput = { branchId: ctx.branchId };
  if (!can(ctx, "orders.view_all")) {
    // Cashiers: last 24 hours only.
    where.createdAt = { gte: new Date(Date.now() - 86_400_000) };
  }
  if (f.scope === "active") where.status = { in: ["NEW", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY"] };
  if (f.status && f.status !== "all") where.status = f.status as OrderStatus;
  if (f.type && f.type !== "all") where.type = f.type as "TAKEAWAY";
  if (f.source && f.source !== "all") where.source = f.source as "POS";
  if (f.payment && f.payment !== "all") where.paymentStatus = f.payment as "PAID";
  if (can(ctx, "orders.view_all") && (f.from || f.to)) {
    where.businessDate = {
      ...(f.from ? { gte: new Date(`${f.from}T00:00:00Z`) } : {}),
      ...(f.to ? { lte: new Date(`${f.to}T00:00:00Z`) } : {}),
    };
  }
  const q = f.q?.trim();
  if (q) {
    const digits = q.replace(/\D/g, "");
    where.OR = [
      { orderNumber: { contains: q, mode: "insensitive" } },
      { customerName: { contains: q, mode: "insensitive" } },
      ...(digits.length >= 4 ? [{ customerPhone: { contains: digits.replace(/^0+/, "").slice(-10) } }] : []),
      ...(/^\d{1,4}$/.test(q) ? [{ displayNumber: Number(q) }] : []),
    ];
  }
  const [rows, total] = await Promise.all([
    db.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        _count: { select: { items: true } },
        createdBy: { select: { name: true } },
        delivery: { select: { rider: { select: { name: true } } } },
      },
    }),
    db.order.count({ where }),
  ]);
  return {
    rows: rows.map(
      (o): OrderListRow => ({
        id: o.id,
        orderNumber: o.orderNumber,
        displayNumber: o.displayNumber,
        createdAt: o.createdAt,
        source: o.source,
        type: o.type,
        status: o.status as OrderStatus,
        paymentStatus: o.paymentStatus,
        customerName: o.customerName,
        customerPhone: o.customerPhone,
        itemCount: o._count.items,
        grandTotal: o.grandTotal.toFixed(2),
        amountPaid: o.amountPaid.toFixed(2),
        createdBy: o.createdBy?.name ?? null,
        riderName: o.delivery?.rider?.name ?? null,
      }),
    ),
    total,
    page,
    pageSize,
  };
}

// ═══ Shared helpers ═════════════════════════════════════════════════════════

type PaymentDraft = { method: "CASH" | "CARD" | "ONLINE"; amount: Prisma.Decimal; tendered: Prisma.Decimal | null; change: Prisma.Decimal | null; reference: string | null };

function preparePayments(
  payments: { method: "CASH" | "CARD" | "ONLINE"; amount: string; tendered?: string; reference?: string }[],
): PaymentDraft[] {
  return payments.map((p, i) => {
    const amount = D(p.amount);
    if (amount.lessThanOrEqualTo(0)) throw validationFailed({ [`payments.${i}.amount`]: ["Amount must be more than zero"] });
    if (p.method === "CASH") {
      const tendered = p.tendered ? D(p.tendered) : amount;
      if (tendered.lessThan(amount)) throw validationFailed({ [`payments.${i}.tendered`]: ["Cash received is less than the amount"] });
      return { method: p.method, amount, tendered, change: tendered.minus(amount), reference: null };
    }
    return { method: p.method, amount, tendered: null, change: null, reference: p.reference || null };
  });
}

async function recordPayments(
  tx: Tx,
  ctx: Ctx,
  order: { id: string; branchId: string },
  drafts: PaymentDraft[],
  shiftId: string | null,
  idemPrefix: string,
) {
  for (const [i, p] of drafts.entries()) {
    const payment = await tx.payment.create({
      data: {
        branchId: order.branchId,
        orderId: order.id,
        cashShiftId: shiftId,
        method: p.method,
        amount: p.amount,
        tendered: p.tendered,
        changeGiven: p.change,
        providerReference: p.reference,
        provider: p.reference ? "MANUAL" : null,
        receivedById: ctx.user.id,
        idempotencyKey: `${idemPrefix}:${i}`,
      },
    });
    if (p.method === "CASH") {
      if (!shiftId) throw invalidState("Open a cash shift on this till before taking cash.");
      await tx.cashTransaction.create({
        data: { cashShiftId: shiftId, type: "SALE", amount: p.amount, referenceType: "payment", referenceId: payment.id, createdById: ctx.user.id },
      });
    }
  }
}

function paymentStatusFor(grand: Prisma.Decimal, paid: Prisma.Decimal, refunded: Prisma.Decimal) {
  if (refunded.greaterThan(0)) return refunded.greaterThanOrEqualTo(paid) ? "REFUNDED" : "PARTIALLY_REFUNDED";
  if (paid.isZero()) return "UNPAID";
  return paid.greaterThanOrEqualTo(grand) ? "PAID" : "PARTIALLY_PAID";
}

async function shiftForTerminal(tx: Tx, ctx: Ctx, terminalId: string | null | undefined, required: boolean) {
  if (!terminalId) {
    if (required) throw invalidState("Choose this till's name before taking cash.");
    return null;
  }
  const terminal = await tx.posTerminal.findFirst({ where: { id: terminalId, branchId: ctx.branchId } });
  if (!terminal) throw validationFailed({ terminalId: ["Unknown till"] });
  const shift = await getOpenShift(terminalId, tx);
  if (!shift && required) throw invalidState("Open a cash shift on this till before taking cash.");
  return shift?.id ?? null;
}

async function addHistory(tx: Tx, orderId: string, from: OrderStatus | null, to: OrderStatus, ctx: Ctx | null, source: string, reason?: string | null) {
  await tx.orderStatusHistory.create({
    data: { orderId, fromStatus: from, toStatus: to, changedById: ctx?.user.id ?? null, source, reason: reason || null },
  });
}

// ═══ Create order ═══════════════════════════════════════════════════════════

export type CreateOrderOptions = { channel: "POS" | "ONLINE"; customerUserId?: string | null };

/**
 * Create an order from any channel. Idempotent on clientRequestId: a repeated
 * request returns the original order instead of creating a duplicate.
 */
export async function createOrder(ctx: Ctx, rawInput: unknown, opts: CreateOrderOptions = { channel: "POS" }) {
  const input = parse(createOrderSchema, rawInput);
  const staffSource = (STAFF_SOURCES as readonly string[]).includes(input.source);
  if (staffSource) authorize(ctx, "orders.create");
  const idempotencyKey = `${input.source}:${input.clientRequestId}`;

  const existing = await db.order.findUnique({ where: { idempotencyKey }, select: { id: true, createdById: true } });
  if (existing) return loadOrderDetail(existing.id);

  const [finance, ordering, delivery, numbering] = await Promise.all([
    getSetting("finance"),
    getSetting("ordering"),
    getSetting("delivery"),
    getSetting("numbering"),
  ]);
  if (input.type === "DINE_IN" && !ordering.dineInEnabled) throw validationFailed({ type: ["Dine-in is turned off"] });
  if (input.type === "DELIVERY" && !ordering.deliveryEnabled) throw validationFailed({ type: ["Delivery is turned off"] });
  if (input.type === "TAKEAWAY" && !ordering.takeawayEnabled) throw validationFailed({ type: ["Takeaway is turned off"] });
  if (input.payments.length > 1 && !ordering.splitPaymentEnabled) throw validationFailed({ payments: ["Split payments are turned off"] });

  // Manager approval for big discounts is checked before the transaction so failed PIN attempts are counted.
  let discountApprover: string | null = null;
  if (input.discount && D(input.discount.value).greaterThan(0)) {
    if (!staffSource) throw forbidden("Discounts are applied with coupons online.");
    authorize(ctx, "orders.discount");
  }

  const branch = await db.branch.findUniqueOrThrow({ where: { id: ctx.branchId } });
  // Offline POS sales keep the business day they were made on (accepted up to 48 h late).
  const offlineAt = staffSource && input.offlineCreatedAt ? new Date(input.offlineCreatedAt) : null;
  if (offlineAt && (offlineAt.getTime() > Date.now() + 5 * 60_000 || offlineAt.getTime() < Date.now() - 48 * 3_600_000)) {
    throw validationFailed({ offlineCreatedAt: ["This offline sale is too old to sync automatically. Enter it by hand."] }, "This offline sale is too old to sync automatically. Enter it by hand.");
  }
  const today = businessDate(offlineAt ?? new Date(), branch.timezone, ordering.dayCutoffHour);

  try {
    const orderId = await withTransaction(async (tx) => {
      const lines = await resolveLines(tx, input.items, opts.channel);

      // Customer
      let customer: { id: string; name: string; phone: string | null; isBlocked: boolean } | null = null;
      if (input.customerId) {
        customer = await tx.customer.findUnique({ where: { id: input.customerId } });
        if (!customer) throw validationFailed({ customerId: ["Customer not found"] });
      } else if (input.customer && (input.customer.phone || input.customer.name)) {
        const phone = input.customer.phone ? normalizePhone(input.customer.phone) : null;
        if (input.customer.phone && !phone) throw validationFailed({ "customer.phone": ["Enter a valid phone number"] });
        if (phone || input.type === "DELIVERY") customer = await findOrCreateCustomer(tx, { name: input.customer.name, phone }, ctx);
      }
      if (customer?.isBlocked && !staffSource) throw forbidden("We cannot accept online orders from this account. Please call the restaurant.");
      if (input.type === "DELIVERY" && !(customer?.phone || normalizePhone(input.customer?.phone))) {
        throw validationFailed({ "customer.phone": ["A phone number is required for delivery"] });
      }

      // Totals
      const pricedLines = lines.map((l) => ({ unitPrice: l.unitPrice, addonsUnitTotal: l.addonsUnitTotal, quantity: l.quantity }));
      const methods = input.payments.map((p) => p.method);
      const preview = priceOrder({ lines: pricedLines, discount: input.discount ?? null });

      // Promotions: coupon and loyalty points, always re-validated here.
      const promoPhone = customer?.phone ?? normalizePhone(input.customer?.phone);
      if (input.couponCode && input.discount && D(input.discount.value).greaterThan(0)) {
        throw validationFailed({ couponCode: ["A coupon cannot be combined with a staff discount"] }, "A coupon cannot be combined with a staff discount.");
      }
      const coupon: CouponQuote | null = input.couponCode
        ? await evaluateCoupon(tx, { code: input.couponCode, subtotal: D(preview.subtotal), channel: staffSource ? "POS" : "ONLINE", customerId: customer?.id ?? null, phone: promoPhone })
        : null;
      if (coupon?.freeDelivery && input.type !== "DELIVERY") throw validationFailed({ couponCode: ["This coupon is for delivery orders"] }, "This coupon is for delivery orders.");
      let redeem = { points: 0, amount: D(0) };
      if (input.redeemPoints > 0) {
        if (!customer) throw validationFailed({ redeemPoints: ["Choose the customer to use points"] }, "Choose the customer to use points.");
        // Online, only the signed-in account holder (passed as customerId) may spend points.
        if (!staffSource && input.customerId !== customer.id) throw forbidden("Sign in to use your points.");
        const acct = await tx.customer.findUniqueOrThrow({ where: { id: customer.id }, select: { loyaltyPoints: true, phoneVerifiedAt: true } });
        // Online, points can only be spent from a verified number (stops claiming someone else's points by registering their phone).
        if (!staffSource && !acct.phoneVerifiedAt) {
          throw validationFailed({ redeemPoints: ["Verify your phone number in your account to use points"] }, "Verify your phone number in your account to use points.");
        }
        const balance = acct.loyaltyPoints;
        const eligible = D(preview.subtotal).minus(preview.discount).minus(coupon?.discount ?? 0);
        redeem = redemptionFor(await getSetting("loyalty", tx), input.redeemPoints, balance, eligible);
      }
      const promoTotal = D(preview.discount).plus(coupon?.discount ?? 0).plus(redeem.amount);
      const effectiveDiscount =
        (coupon?.discount.greaterThan(0) || redeem.amount.greaterThan(0)) && promoTotal.greaterThan(0)
          ? { type: "AMOUNT" as const, value: promoTotal.toFixed(2) }
          : (input.discount ?? null);
      let deliveryWaived = D(0);

      let deliveryCharge = "0";
      let zone: { id: string; charge: Prisma.Decimal; freeAbove: Prisma.Decimal | null; minimumOrder: Prisma.Decimal; estimatedMinutes: number } | null = null;
      if (input.type === "DELIVERY") {
        if (input.delivery?.zoneId) {
          zone = await tx.deliveryZone.findFirst({ where: { id: input.delivery.zoneId, branchId: ctx.branchId, deletedAt: null, isActive: true } });
          if (!zone) throw validationFailed({ "delivery.zoneId": ["Choose a valid delivery area"] });
        }
        const afterDiscount = D(preview.subtotal).minus(preview.discount);
        const minimum = zone ? zone.minimumOrder : D(delivery.minimumOrder);
        if (!staffSource && afterDiscount.lessThan(minimum)) {
          throw validationFailed({ items: [`Minimum order for delivery is Rs ${minimum.toFixed(0)}`] }, `Minimum order for delivery is Rs ${minimum.toFixed(0)}.`);
        }
        deliveryCharge = deliveryChargeFor(afterDiscount, zone ? { charge: zone.charge, freeAbove: zone.freeAbove } : null, delivery);
        if (coupon?.freeDelivery) {
          deliveryWaived = D(deliveryCharge);
          deliveryCharge = "0";
        }
      }
      const onlyCash = methods.length > 0 && methods.every((m) => m === "CASH");
      const pricing = priceOrder({
        lines: pricedLines,
        discount: effectiveDiscount,
        serviceChargePercent: input.type === "DINE_IN" && finance.serviceChargeEnabled ? finance.serviceChargePercent : 0,
        deliveryCharge,
        tax: { enabled: finance.taxEnabled, rate: taxRateFor(methods.length ? methods : ["CASH"], finance), inclusive: finance.pricesIncludeTax },
        cashRoundingStep: onlyCash ? finance.cashRoundingStep : 0,
      });

      // Discount limit for cashiers
      if (input.discount && D(preview.discount).greaterThan(0)) {
        const pos = await getSetting("pos", tx);
        if (preview.discountPercent > pos.cashierMaxDiscountPercent) {
          discountApprover = await authorizeOrOverride(ctx, "orders.discount.override", input.overridePin);
        }
      }

      // Payments
      const drafts = preparePayments(input.payments);
      const paid = drafts.reduce((a, p) => a.plus(p.amount), D(0));
      const grand = D(pricing.grandTotal);
      if (paid.greaterThan(grand)) throw validationFailed({ payments: ["Payments are more than the order total"] });
      if (staffSource && paid.greaterThan(0) && paid.lessThan(grand)) {
        throw validationFailed({ payments: [`Payments must cover the full total (Rs ${grand.toFixed(2)})`] });
      }
      const hasCash = drafts.some((p) => p.method === "CASH");
      const shiftId = staffSource ? await shiftForTerminal(tx, ctx, input.terminalId, hasCash) : null;

      // Number
      const seq = await nextSequence(tx, ctx.branchId, "ORDER", today.replaceAll("-", ""));
      const orderNumber = `${numbering.orderPrefix}${compactDate(today)}-${String(seq).padStart(4, "0")}`;

      const now = new Date();
      const initialStatus: OrderStatus = staffSource || ordering.autoAcceptOnlineOrders ? "ACCEPTED" : "NEW";
      const maxPrep = Math.max(ordering.defaultPrepMinutes, ...lines.map((l) => l.prepTimeMinutes));
      const estimatedCost = lines.reduce((a, l) => a.plus(l.unitCost.plus(l.addonsUnitCost).times(l.quantity)), D(0));
      const custName = customer?.name ?? (input.customer?.name || null);
      const custPhone = customer?.phone ?? normalizePhone(input.customer?.phone);

      const order = await tx.order.create({
        data: {
          branchId: ctx.branchId,
          orderNumber,
          displayNumber: seq,
          businessDate: new Date(`${today}T00:00:00Z`),
          source: input.source,
          type: input.type,
          status: initialStatus,
          paymentStatus: paymentStatusFor(grand, paid, D(0)),
          customerId: customer?.id ?? null,
          customerName: custName,
          customerPhone: custPhone,
          tableLabel: input.tableLabel || null,
          createdById: staffSource ? ctx.user.id : null,
          cashShiftId: shiftId,
          terminalId: input.terminalId ?? null,
          subtotal: pricing.subtotal,
          discountTotal: pricing.discount,
          serviceCharge: pricing.serviceCharge,
          deliveryCharge: pricing.deliveryCharge,
          taxTotal: pricing.tax,
          taxRate: pricing.taxRate,
          taxInclusive: finance.pricesIncludeTax,
          roundingAdjustment: pricing.rounding,
          grandTotal: pricing.grandTotal,
          amountPaid: paid,
          estimatedCostTotal: estimatedCost,
          couponId: coupon?.couponId ?? null,
          loyaltyPointsRedeemed: redeem.points,
          customerNote: input.customerNote || null,
          kitchenNote: input.kitchenNote || null,
          estimatedReadyAt: new Date(now.getTime() + maxPrep * 60_000),
          scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
          acceptedAt: initialStatus === "ACCEPTED" ? now : null,
          idempotencyKey,
          trackingToken: randomBytes(18).toString("base64url"),
          offlineCreatedAt: offlineAt,
        },
      });

      for (const [i, l] of lines.entries()) {
        await tx.orderItem.create({
          data: {
            orderId: order.id,
            productId: l.productId,
            variantId: l.variantId,
            categoryId: l.categoryId,
            productName: l.productName,
            variantName: l.variantName,
            sku: l.sku,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            addonsUnitTotal: l.addonsUnitTotal,
            lineTotal: pricing.lineTotals[i]!,
            unitCostEstimate: l.unitCost.plus(l.addonsUnitCost),
            note: l.note || null,
            sortOrder: (i + 1) * 10,
            addons: { create: l.addons.map((a) => ({ addonId: a.addonId, groupName: a.groupName, addonName: a.addonName, unitPrice: a.unitPrice, unitCostEstimate: a.unitCost })) },
            removals: { create: l.removals.map((r) => ({ removableOptionId: r.removableOptionId, label: r.label })) },
          },
        });
      }

      if (D(preview.discount).greaterThan(0) && input.discount) {
        await tx.orderDiscount.create({
          data: {
            orderId: order.id,
            kind: "MANUAL",
            percent: input.discount.type === "PERCENT" ? input.discount.value : null,
            amount: preview.discount,
            reason: input.discount.reason || null,
            appliedById: ctx.user.id,
            approvedById: discountApprover,
          },
        });
        await recordAudit(tx, ctx, {
          action: "order.discount",
          module: "orders",
          entityType: "order",
          entityId: order.id,
          after: { orderNumber, amount: preview.discount, percent: preview.discountPercent },
          reason: input.discount.reason || undefined,
          overrideUserId: discountApprover ?? undefined,
        });
      }

      if (coupon) {
        if (coupon.discount.greaterThan(0)) {
          await tx.orderDiscount.create({ data: { orderId: order.id, kind: "COUPON", couponId: coupon.couponId, amount: coupon.discount, reason: coupon.code, appliedById: ctx.user.id || null } });
        }
        await redeemCoupon(tx, coupon, { id: order.id, customerId: customer?.id ?? null, phone: promoPhone }, coupon.freeDelivery ? deliveryWaived : coupon.discount);
      }
      if (redeem.points > 0 && customer) {
        await tx.orderDiscount.create({ data: { orderId: order.id, kind: "LOYALTY", amount: redeem.amount, reason: `${redeem.points} points`, appliedById: ctx.user.id || null } });
        await redeemForOrder(tx, customer.id, order.id, redeem.points, ctx.user.id || null);
      }

      if (drafts.length) await recordPayments(tx, ctx, order, drafts, shiftId, idempotencyKey);

      if (input.type === "DELIVERY" && input.delivery) {
        await tx.delivery.create({
          data: {
            orderId: order.id,
            branchId: ctx.branchId,
            zoneId: zone?.id ?? null,
            recipientName: custName ?? "Customer",
            phone: custPhone ?? "",
            addressText: [input.delivery.addressLine, input.delivery.area].filter(Boolean).join(", "),
            landmark: input.delivery.landmark || null,
            mapUrl: input.delivery.mapUrl || null,
            latitude: input.delivery.latitude ?? null,
            longitude: input.delivery.longitude ?? null,
            deliveryCharge: pricing.deliveryCharge,
            codAmount: grand.minus(paid),
          },
        });
        if (customer && input.delivery.saveAddress) {
          const same = await tx.customerAddress.findFirst({ where: { customerId: customer.id, addressLine: input.delivery.addressLine } });
          if (!same) {
            const count = await tx.customerAddress.count({ where: { customerId: customer.id } });
            await tx.customerAddress.create({
              data: {
                customerId: customer.id,
                label: count === 0 ? "Home" : `Address ${count + 1}`,
                addressLine: input.delivery.addressLine,
                area: input.delivery.area || null,
                landmark: input.delivery.landmark || null,
                mapUrl: input.delivery.mapUrl || null,
                zoneId: zone?.id ?? null,
                isDefault: count === 0,
              },
            });
          }
        }
      }

      await addHistory(tx, order.id, null, initialStatus, staffSource ? ctx : null, staffSource ? input.source : "CUSTOMER");
      if (customer) {
        await tx.customer.update({
          where: { id: customer.id },
          data: { totalOrders: { increment: 1 }, totalSpent: { increment: grand }, lastOrderAt: now },
        });
      }
      await runStatusHooks(tx, { orderId: order.id, from: null, to: initialStatus, ctx });
      await emit(tx, { type: "order.created", orderId: order.id, branchId: ctx.branchId, status: initialStatus, source: input.source });
      return order.id;
    });
    return loadOrderDetail(orderId);
  } catch (e) {
    // Two identical requests racing: the loser hits the unique idempotency key.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const dup = await db.order.findUnique({ where: { idempotencyKey }, select: { id: true } });
      if (dup) return loadOrderDetail(dup.id);
    }
    throw e;
  }
}

/** Quote totals without saving (POS display and website cart). */
export async function quoteOrder(
  ctx: Ctx | null,
  input: Pick<CreateOrderInput, "items" | "type" | "discount" | "delivery" | "payments" | "couponCode" | "redeemPoints" | "customerId" | "customer">,
  channel: "POS" | "ONLINE",
) {
  const [finance, delivery, loyalty] = await Promise.all([getSetting("finance"), getSetting("delivery"), getSetting("loyalty")]);
  const lines = await resolveLines(db, input.items, channel);
  const pricedLines = lines.map((l) => ({ unitPrice: l.unitPrice, addonsUnitTotal: l.addonsUnitTotal, quantity: l.quantity }));
  const preview = priceOrder({ lines: pricedLines, discount: input.discount ?? null });
  const cust = input.customerId ? await db.customer.findUnique({ where: { id: input.customerId }, select: { id: true, phone: true, loyaltyPoints: true } }) : null;
  const phone = cust?.phone ?? normalizePhone(input.customer?.phone);
  if (input.couponCode && input.discount && D(input.discount.value).greaterThan(0)) {
    throw validationFailed({ couponCode: ["A coupon cannot be combined with a staff discount"] }, "A coupon cannot be combined with a staff discount.");
  }
  const coupon = input.couponCode ? await evaluateCoupon(db, { code: input.couponCode, subtotal: D(preview.subtotal), channel, customerId: cust?.id ?? null, phone }) : null;
  if (coupon?.freeDelivery && input.type !== "DELIVERY") throw validationFailed({ couponCode: ["This coupon is for delivery orders"] }, "This coupon is for delivery orders.");
  let redeem = { points: 0, amount: D(0) };
  if ((input.redeemPoints ?? 0) > 0 && cust) {
    redeem = redemptionFor(loyalty, input.redeemPoints ?? 0, cust.loyaltyPoints, D(preview.subtotal).minus(preview.discount).minus(coupon?.discount ?? 0));
  }
  const promoTotal = D(preview.discount).plus(coupon?.discount ?? 0).plus(redeem.amount);
  const effectiveDiscount =
    (coupon?.discount.greaterThan(0) || redeem.amount.greaterThan(0)) && promoTotal.greaterThan(0) ? { type: "AMOUNT" as const, value: promoTotal.toFixed(2) } : (input.discount ?? null);
  let deliveryWaived = "0.00";
  let deliveryCharge = "0";
  let minimumOrder = "0";
  if (input.type === "DELIVERY") {
    const zone = input.delivery?.zoneId
      ? await db.deliveryZone.findFirst({ where: { id: input.delivery.zoneId, deletedAt: null, isActive: true } })
      : null;
    const afterDiscount = D(preview.subtotal).minus(preview.discount);
    deliveryCharge = deliveryChargeFor(afterDiscount, zone ? { charge: zone.charge, freeAbove: zone.freeAbove } : null, delivery);
    minimumOrder = (zone ? zone.minimumOrder : D(delivery.minimumOrder)).toFixed(2);
    if (coupon?.freeDelivery) {
      deliveryWaived = deliveryCharge;
      deliveryCharge = "0";
    }
  }
  const ordering = await getSetting("ordering");
  const methods = (input.payments ?? []).map((p) => p.method);
  const result = priceOrder({
    lines: pricedLines,
    discount: effectiveDiscount,
    serviceChargePercent: input.type === "DINE_IN" && finance.serviceChargeEnabled ? finance.serviceChargePercent : 0,
    deliveryCharge,
    tax: { enabled: finance.taxEnabled, rate: taxRateFor(methods.length ? methods : ["CASH"], finance), inclusive: finance.pricesIncludeTax },
    cashRoundingStep: methods.length > 0 && methods.every((m) => m === "CASH") ? finance.cashRoundingStep : 0,
  });
  void ctx;
  return {
    ...result,
    minimumOrder,
    prepMinutes: Math.max(ordering.defaultPrepMinutes, ...lines.map((l) => l.prepTimeMinutes)),
    coupon: coupon ? { code: coupon.code, discount: (coupon.freeDelivery ? D(deliveryWaived) : coupon.discount).toFixed(2), freeDelivery: coupon.freeDelivery } : null,
    loyalty: {
      enabled: loyalty.enabled,
      balance: cust?.loyaltyPoints ?? null,
      used: redeem.points,
      amount: redeem.amount.toFixed(2),
      toEarn: pointsFor(loyalty, D(result.subtotal).minus(result.discount)),
      minimumRedeemPoints: loyalty.minimumRedeemPoints,
    },
  };
}

// ═══ Payments ═══════════════════════════════════════════════════════════════

/** Take payment for an unpaid / partly paid order (phone, delivery, pay-at-counter). */
export async function addPayment(ctx: Ctx, orderId: string, rawInput: unknown) {
  authorize(ctx, "orders.create");
  const input = parse(addPaymentSchema, rawInput);
  const idemPrefix = `PAY:${input.clientRequestId}`;
  if (await db.payment.findFirst({ where: { idempotencyKey: `${idemPrefix}:0` }, select: { id: true } })) {
    return loadOrderDetail(orderId);
  }
  await withTransaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order || order.branchId !== ctx.branchId) throw notFound("Order");
    if (order.status === "CANCELLED" || order.status === "REFUNDED") throw invalidState("This order is closed.");
    const drafts = preparePayments(input.payments);
    const paying = drafts.reduce((a, p) => a.plus(p.amount), D(0));
    const due = order.grandTotal.minus(order.amountPaid);
    if (paying.greaterThan(due)) throw validationFailed({ payments: [`Only Rs ${due.toFixed(2)} is due`] });
    const shiftId = await shiftForTerminal(tx, ctx, input.terminalId, drafts.some((p) => p.method === "CASH"));
    await recordPayments(tx, ctx, order, drafts, shiftId, idemPrefix);
    const paid = order.amountPaid.plus(paying);
    await tx.order.update({
      where: { id: orderId },
      data: {
        amountPaid: paid,
        paymentStatus: paymentStatusFor(order.grandTotal, paid, order.amountRefunded),
        cashShiftId: order.cashShiftId ?? shiftId,
        version: { increment: 1 },
      },
    });
    if (paid.greaterThanOrEqualTo(order.grandTotal)) {
      await tx.delivery.updateMany({ where: { orderId }, data: { codAmount: 0 } });
    }
    await emit(tx, { type: "order.paid", orderId, branchId: order.branchId });
  });
  return loadOrderDetail(orderId);
}

// ═══ Status transitions ═════════════════════════════════════════════════════

export async function transitionOrder(
  ctx: Ctx,
  orderId: string,
  to: OrderStatus,
  opts: { source?: string; reason?: string; expectedVersion?: number } = {},
) {
  if (to === "CANCELLED" || to === "REFUNDED") throw invalidState("Use cancel or refund for this.");
  // Riders change their own deliveries through the rider service, which checks
  // the assignment; the generic transition requires a staff permission.
  const perms = TRANSITION_PERMISSIONS[to].filter((p) => p !== "delivery.rider");
  if (!perms.some((p) => can(ctx, p))) throw forbidden();
  await withTransaction(async (tx) => {
    await transitionInTx(tx, ctx, orderId, to, opts);
  });
  return loadOrderDetail(orderId);
}

export async function transitionInTx(
  tx: Tx,
  ctx: Ctx | null,
  orderId: string,
  to: OrderStatus,
  opts: { source?: string; reason?: string; expectedVersion?: number } = {},
) {
  const order = await tx.order.findUnique({ where: { id: orderId }, include: { delivery: true } });
  if (!order || (ctx && order.branchId !== ctx.branchId)) throw notFound("Order");
  if (opts.expectedVersion !== undefined && opts.expectedVersion !== order.version) {
    throw new AppError("CONFLICT", "This order was just updated on another screen. Refresh and try again.");
  }
  const from = order.status as OrderStatus;
  if (from === to) return;
  if (!canTransition(from, to, order.type)) throw invalidState(`Cannot move an order from ${from} to ${to}.`);
  if (to === "COMPLETED" && order.type !== "DELIVERY" && order.amountPaid.lessThan(order.grandTotal)) {
    throw invalidState("Take payment before completing this order.");
  }
  if (to === "OUT_FOR_DELIVERY" && !order.delivery?.riderId) throw invalidState("Assign a rider first.");
  const stamp = STATUS_TIMESTAMP[to];
  const res = await tx.order.updateMany({
    where: { id: orderId, version: order.version },
    data: { status: to, version: { increment: 1 }, ...(stamp ? { [stamp]: new Date() } : {}) },
  });
  if (res.count !== 1) throw new AppError("CONFLICT", "This order was just updated on another screen. Refresh and try again.");
  if (to === "OUT_FOR_DELIVERY") await tx.delivery.update({ where: { orderId }, data: { status: "OUT_FOR_DELIVERY", dispatchedAt: new Date() } });
  if (to === "COMPLETED" && order.type === "DELIVERY") {
    await tx.delivery.update({
      where: { orderId },
      data: {
        status: "DELIVERED",
        deliveredAt: new Date(),
        ...(order.delivery && order.delivery.codAmount.greaterThan(0) ? { codCollectedAt: new Date() } : {}),
      },
    });
  }
  await addHistory(tx, orderId, from, to, ctx, opts.source ?? "ADMIN", opts.reason);
  await runStatusHooks(tx, { orderId, from, to, ctx });
  await emit(tx, { type: "order.status_changed", orderId, branchId: order.branchId, from, to });
}

// ═══ Refunds & cancellation ═════════════════════════════════════════════════

async function performRefund(
  tx: Tx,
  ctx: Ctx,
  order: { id: string; branchId: string; grandTotal: Prisma.Decimal; amountPaid: Prisma.Decimal; amountRefunded: Prisma.Decimal; customerId: string | null; orderNumber: string },
  r: { amount: Prisma.Decimal; method: "CASH" | "CARD" | "ONLINE"; reason: string; restock: boolean; paymentId?: string | null },
  shiftId: string | null,
  approverId: string | null,
) {
  const n = await nextSequence(tx, order.branchId, "REFUND", "ALL");
  const numbering = await getSetting("numbering", tx);
  const refund = await tx.refund.create({
    data: {
      branchId: order.branchId,
      refundNumber: formatDocNumber(numbering.refundPrefix, n),
      orderId: order.id,
      paymentId: r.paymentId ?? null,
      amount: r.amount,
      method: r.method,
      reason: r.reason,
      restock: r.restock,
      requestedById: ctx.user.id,
      approvedById: approverId,
      cashShiftId: r.method === "CASH" ? shiftId : null,
    },
  });
  if (r.method === "CASH") {
    if (!shiftId) throw invalidState("Open a cash shift on this till to give a cash refund.");
    await tx.cashTransaction.create({
      data: { cashShiftId: shiftId, type: "REFUND", amount: r.amount.negated(), referenceType: "refund", referenceId: refund.id, reason: r.reason, createdById: ctx.user.id },
    });
  }
  if (order.customerId) await tx.customer.update({ where: { id: order.customerId }, data: { totalSpent: { decrement: r.amount } } });
  const pos = await getSetting("pos", tx);
  await recordAudit(tx, ctx, {
    action: "order.refund",
    module: "orders",
    entityType: "order",
    entityId: order.id,
    after: { orderNumber: order.orderNumber, refundNumber: refund.refundNumber, amount: r.amount.toFixed(2), method: r.method },
    reason: r.reason,
    overrideUserId: approverId ?? undefined,
  });
  await emit(tx, {
    type: "order.refunded",
    orderId: order.id,
    branchId: order.branchId,
    amount: r.amount.toFixed(2),
    large: r.amount.greaterThanOrEqualTo(D(pos.largeRefundThreshold)),
  });
  return refund;
}

export async function refundOrder(ctx: Ctx, orderId: string, rawInput: unknown) {
  const input = parse(refundInputSchema, rawInput);
  const approverId = await authorizeOrOverride(ctx, "orders.refund", input.overridePin);
  await withTransaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order || order.branchId !== ctx.branchId) throw notFound("Order");
    const refundable = order.amountPaid.minus(order.amountRefunded);
    const amount = D(input.amount);
    if (amount.lessThanOrEqualTo(0)) throw validationFailed({ amount: ["Amount must be more than zero"] });
    if (amount.greaterThan(refundable)) throw validationFailed({ amount: [`At most Rs ${refundable.toFixed(2)} can be refunded`] });
    const shiftId = input.method === "CASH" ? await shiftForTerminal(tx, ctx, input.terminalId, true) : null;
    await performRefund(tx, ctx, order, { amount, method: input.method, reason: input.reason, restock: input.restock }, shiftId, approverId);
    await reverseForRefund(tx, orderId, amount);
    const refunded = order.amountRefunded.plus(amount);
    const full = refunded.greaterThanOrEqualTo(order.amountPaid);
    await tx.order.update({
      where: { id: orderId },
      data: {
        amountRefunded: refunded,
        paymentStatus: paymentStatusFor(order.grandTotal, order.amountPaid, refunded),
        version: { increment: 1 },
        ...(full && order.status === "COMPLETED" ? { status: "REFUNDED" } : {}),
      },
    });
    if (full && order.status === "COMPLETED") {
      await addHistory(tx, orderId, "COMPLETED", "REFUNDED", ctx, "ADMIN", input.reason);
      await emit(tx, { type: "order.status_changed", orderId, branchId: order.branchId, from: "COMPLETED", to: "REFUNDED" });
    }
  });
  return loadOrderDetail(orderId);
}

/** Cancel an open order. Money already taken is refunded to the original methods. */
export async function cancelOrder(ctx: Ctx, orderId: string, rawInput: unknown, opts: { source?: string } = {}) {
  const input = parse(cancelInputSchema, rawInput);
  const approverId = await authorizeOrOverride(ctx, "orders.cancel", input.overridePin);
  await withTransaction(async (tx) => {
    await cancelInTx(tx, ctx, orderId, { reason: input.reason, terminalId: input.terminalId ?? null, approverId, source: opts.source ?? "ADMIN" });
  });
  return loadOrderDetail(orderId);
}

export async function cancelInTx(
  tx: Tx,
  ctx: Ctx,
  orderId: string,
  opts: { reason: string; terminalId: string | null; approverId: string | null; source: string },
) {
  const order = await tx.order.findUnique({ where: { id: orderId }, include: { payments: { where: { status: "SUCCEEDED" } }, refunds: true } });
  if (!order || order.branchId !== ctx.branchId) throw notFound("Order");
  const from = order.status as OrderStatus;
  if (!canTransition(from, "CANCELLED", order.type)) throw invalidState("Completed orders cannot be cancelled. Refund them instead.");

  const remaining = order.amountPaid.minus(order.amountRefunded);
  if (remaining.greaterThan(0)) {
    const needsCash = order.payments.some((p) => p.method === "CASH");
    const shiftId = needsCash ? await shiftForTerminal(tx, ctx, opts.terminalId, true) : null;
    let left = remaining;
    for (const p of order.payments) {
      if (left.lessThanOrEqualTo(0)) break;
      const alreadyRefunded = order.refunds.filter((r) => r.paymentId === p.id).reduce((a, r) => a.plus(r.amount), D(0));
      const amount = Prisma.Decimal.min(p.amount.minus(alreadyRefunded), left);
      if (amount.lessThanOrEqualTo(0)) continue;
      await performRefund(
        tx,
        ctx,
        order,
        { amount, method: p.method as "CASH", reason: `Cancelled: ${opts.reason}`, restock: false, paymentId: p.id },
        shiftId,
        opts.approverId,
      );
      left = left.minus(amount);
    }
  }
  const res = await tx.order.updateMany({
    where: { id: orderId, version: order.version },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelReason: opts.reason,
      cancelledById: ctx.user.id,
      amountRefunded: order.amountPaid,
      paymentStatus: order.amountPaid.greaterThan(0) ? "REFUNDED" : "UNPAID",
      version: { increment: 1 },
    },
  });
  if (res.count !== 1) throw new AppError("CONFLICT", "This order was just updated on another screen. Refresh and try again.");
  await tx.delivery.updateMany({ where: { orderId }, data: { status: "FAILED", codAmount: 0 } });
  if (order.customerId) {
    // Refunds already reduced total spent; remove the rest of this order's value.
    await tx.customer.update({
      where: { id: order.customerId },
      data: { totalOrders: { decrement: 1 }, totalSpent: { decrement: order.grandTotal.minus(order.amountPaid) } },
    });
  }
  await addHistory(tx, orderId, from, "CANCELLED", ctx, opts.source, opts.reason);
  await recordAudit(tx, ctx, {
    action: "order.cancel",
    module: "orders",
    entityType: "order",
    entityId: orderId,
    before: { status: from, total: order.grandTotal.toFixed(2), paid: order.amountPaid.toFixed(2) },
    after: { status: "CANCELLED" },
    reason: opts.reason,
    overrideUserId: opts.approverId ?? undefined,
  });
  await runStatusHooks(tx, { orderId, from, to: "CANCELLED", ctx });
  await emit(tx, { type: "order.cancelled", orderId, branchId: order.branchId });
}
