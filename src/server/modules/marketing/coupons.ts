import "server-only";
import { z } from "zod";
import { db, withTransaction, Prisma, type Db } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";
import { authorize } from "@/server/core/rbac";
import { recordAudit, diffObjects } from "@/server/core/audit";
import { conflict, notFound, validationFailed } from "@/server/core/errors";
import { zodFieldErrors } from "@/server/core/action";

const D = (v: string | number | Prisma.Decimal | null | undefined) => new Prisma.Decimal(v ?? 0);
const amount = z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/, "Enter an amount");

export const couponSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(3, "At least 3 characters")
      .max(24)
      .regex(/^[A-Za-z0-9_-]+$/, "Letters, numbers, - and _ only")
      .transform((v) => v.toUpperCase()),
    description: z.string().trim().max(200).optional().default(""),
    type: z.enum(["PERCENT", "AMOUNT", "FREE_DELIVERY"]),
    value: amount.default("0"),
    maxDiscount: z.union([amount, z.literal("")]).optional().default(""),
    minOrder: amount.default("0"),
    startsAt: z.union([z.iso.datetime({ offset: true, local: true }), z.literal("")]).optional().default(""),
    endsAt: z.union([z.iso.datetime({ offset: true, local: true }), z.literal("")]).optional().default(""),
    usageLimit: z.union([z.coerce.number().int().min(1), z.literal("")]).optional().default(""),
    perCustomerLimit: z.union([z.coerce.number().int().min(1), z.literal("")]).optional().default(""),
    firstOrderOnly: z.boolean().default(false),
    channel: z.enum(["ALL", "ONLINE", "POS"]).default("ALL"),
    isActive: z.boolean().default(true),
  })
  .superRefine((v, c) => {
    if (v.type === "PERCENT" && (Number(v.value) <= 0 || Number(v.value) > 100)) c.addIssue({ code: "custom", path: ["value"], message: "Enter a percentage from 1 to 100" });
    if (v.type === "AMOUNT" && Number(v.value) <= 0) c.addIssue({ code: "custom", path: ["value"], message: "Enter the discount amount" });
    if (v.startsAt && v.endsAt && new Date(v.endsAt) <= new Date(v.startsAt)) c.addIssue({ code: "custom", path: ["endsAt"], message: "Must be after the start" });
  });
export type CouponInput = z.input<typeof couponSchema>;

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw validationFailed(zodFieldErrors(r.error));
  return r.data;
}

/** Datetime-local strings are Karachi local time; store as instants. */
function toInstant(v: string): Date | null {
  if (!v) return null;
  return /[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? new Date(v) : new Date(`${v}${v.length === 16 ? ":00" : ""}+05:00`);
}

export async function listCoupons(ctx: Ctx) {
  authorize(ctx, "coupons.manage");
  const rows = await db.coupon.findMany({ where: { deletedAt: null }, orderBy: [{ isActive: "desc" }, { createdAt: "desc" }] });
  const sums = await db.couponRedemption.groupBy({ by: ["couponId"], where: { reversedAt: null }, _sum: { amount: true }, _count: true });
  const now = new Date();
  return rows.map((c) => {
    const s = sums.find((x) => x.couponId === c.id);
    const state = !c.isActive
      ? "Paused"
      : c.endsAt && c.endsAt < now
        ? "Ended"
        : c.startsAt && c.startsAt > now
          ? "Scheduled"
          : c.usageLimit !== null && c.usedCount >= c.usageLimit
            ? "Used up"
            : "Live";
    return {
      id: c.id,
      code: c.code,
      description: c.description,
      type: c.type,
      value: c.value.toFixed(2),
      minOrder: c.minOrder.toFixed(2),
      channel: c.channel,
      usedCount: c.usedCount,
      usageLimit: c.usageLimit,
      endsAt: c.endsAt,
      state,
      discountGiven: (s?._sum.amount ?? D(0)).toFixed(2),
    };
  });
}

export async function getCoupon(ctx: Ctx, id: string): Promise<CouponInput & { id: string }> {
  authorize(ctx, "coupons.manage");
  const c = await db.coupon.findFirst({ where: { id, deletedAt: null } });
  if (!c) throw notFound("Coupon");
  const local = (d: Date | null) => (d ? new Date(d.getTime() + 5 * 3_600_000).toISOString().slice(0, 16) : "");
  return {
    id: c.id,
    code: c.code,
    description: c.description ?? "",
    type: c.type,
    value: c.value.toFixed(2),
    maxDiscount: c.maxDiscount?.toFixed(2) ?? "",
    minOrder: c.minOrder.toFixed(2),
    startsAt: local(c.startsAt),
    endsAt: local(c.endsAt),
    usageLimit: c.usageLimit ?? "",
    perCustomerLimit: c.perCustomerLimit ?? "",
    firstOrderOnly: c.firstOrderOnly,
    channel: c.channel,
    isActive: c.isActive,
  };
}

export async function saveCoupon(ctx: Ctx, id: string | null, input: unknown) {
  authorize(ctx, "coupons.manage");
  const d = parse(couponSchema, input);
  const data = {
    code: d.code,
    description: d.description || null,
    type: d.type,
    value: d.type === "FREE_DELIVERY" ? D(0) : D(d.value),
    maxDiscount: d.type === "PERCENT" && d.maxDiscount ? D(d.maxDiscount) : null,
    minOrder: D(d.minOrder),
    startsAt: toInstant(d.startsAt),
    endsAt: toInstant(d.endsAt),
    usageLimit: d.usageLimit === "" ? null : d.usageLimit,
    perCustomerLimit: d.perCustomerLimit === "" ? null : d.perCustomerLimit,
    firstOrderOnly: d.firstOrderOnly,
    channel: d.channel,
    isActive: d.isActive,
  };
  return withTransaction(async (tx) => {
    const clash = await tx.coupon.findFirst({ where: { code: { equals: d.code, mode: "insensitive" }, deletedAt: null, ...(id ? { NOT: { id } } : {}) } });
    if (clash) throw validationFailed({ code: ["This code is already in use"] });
    if (id) {
      const before = await tx.coupon.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw notFound("Coupon");
      await tx.coupon.update({ where: { id }, data });
      const plain = (c: typeof data) => ({ ...c, value: c.value.toFixed(2), minOrder: c.minOrder.toFixed(2), maxDiscount: c.maxDiscount?.toFixed(2) ?? null, startsAt: c.startsAt?.toISOString() ?? null, endsAt: c.endsAt?.toISOString() ?? null });
      await recordAudit(tx, ctx, { action: "coupon.update", module: "marketing", entityType: "coupon", entityId: id, ...diffObjects(plain({ ...before, description: before.description } as typeof data), plain(data)) });
      return { id };
    }
    const c = await tx.coupon.create({ data: { ...data, createdById: ctx.user.id } });
    await recordAudit(tx, ctx, { action: "coupon.create", module: "marketing", entityType: "coupon", entityId: c.id, after: { code: d.code, type: d.type, value: d.value } });
    return { id: c.id };
  });
}

export async function archiveCoupon(ctx: Ctx, id: string) {
  authorize(ctx, "coupons.manage");
  await withTransaction(async (tx) => {
    const c = await tx.coupon.findFirst({ where: { id, deletedAt: null } });
    if (!c) throw notFound("Coupon");
    await tx.coupon.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await recordAudit(tx, ctx, { action: "coupon.archive", module: "marketing", entityType: "coupon", entityId: id, before: { code: c.code } });
  });
}

// ═══ Applying coupons to orders ══════════════════════════════════════════════

export type CouponQuote = { couponId: string; code: string; type: "PERCENT" | "AMOUNT" | "FREE_DELIVERY"; discount: Prisma.Decimal; freeDelivery: boolean };

const invalid = (msg: string) => validationFailed({ couponCode: [msg] }, msg);

/**
 * Check a code against an order and work out its discount. Throws a friendly
 * validation error when the coupon cannot be used. Does not record anything.
 */
export async function evaluateCoupon(
  client: Db,
  input: { code: string; subtotal: Prisma.Decimal; channel: "POS" | "ONLINE"; customerId: string | null; phone: string | null; now?: Date },
): Promise<CouponQuote> {
  const now = input.now ?? new Date();
  const code = input.code.trim().toUpperCase();
  const c = await client.coupon.findFirst({ where: { code: { equals: code, mode: "insensitive" }, deletedAt: null } });
  if (!c || !c.isActive) throw invalid("This coupon code is not valid.");
  if (c.startsAt && c.startsAt > now) throw invalid("This coupon is not active yet.");
  if (c.endsAt && c.endsAt < now) throw invalid("This coupon has expired.");
  if (c.channel !== "ALL" && c.channel !== input.channel) throw invalid(c.channel === "ONLINE" ? "This coupon is for online orders only." : "This coupon is for orders at the counter only.");
  if (c.usageLimit !== null && c.usedCount >= c.usageLimit) throw invalid("This coupon has been fully used.");
  if (input.subtotal.lessThan(c.minOrder)) throw invalid(`Add items worth Rs ${c.minOrder.minus(input.subtotal).toFixed(0)} more to use this coupon.`);

  const who: Prisma.CouponRedemptionWhereInput[] = [];
  if (input.customerId) who.push({ customerId: input.customerId });
  if (input.phone) who.push({ phone: input.phone });
  if ((c.perCustomerLimit !== null || c.firstOrderOnly) && who.length === 0) {
    throw invalid("Enter the customer's phone number to use this coupon.");
  }
  if (c.perCustomerLimit !== null) {
    const used = await client.couponRedemption.count({ where: { couponId: c.id, reversedAt: null, OR: who } });
    if (used >= c.perCustomerLimit) throw invalid("This coupon has already been used by this customer.");
  }
  if (c.firstOrderOnly) {
    const previous = await client.order.count({
      where: { status: { notIn: ["CANCELLED"] }, OR: [...(input.customerId ? [{ customerId: input.customerId }] : []), ...(input.phone ? [{ customerPhone: input.phone }] : [])] },
    });
    if (previous > 0) throw invalid("This coupon is for a customer's first order only.");
  }

  let discount = D(0);
  if (c.type === "PERCENT") {
    discount = input.subtotal.times(c.value).div(100).toDecimalPlaces(2);
    if (c.maxDiscount) discount = Prisma.Decimal.min(discount, c.maxDiscount);
  } else if (c.type === "AMOUNT") {
    discount = Prisma.Decimal.min(c.value, input.subtotal);
  }
  return { couponId: c.id, code: c.code, type: c.type, discount, freeDelivery: c.type === "FREE_DELIVERY" };
}

/** Record a redemption and count the use; refuses if the last use was just taken. */
export async function redeemCoupon(tx: Db, q: CouponQuote, order: { id: string; customerId: string | null; phone: string | null }, amount: Prisma.Decimal) {
  const updated = await tx.$executeRaw`
    UPDATE coupons SET used_count = used_count + 1, updated_at = now()
     WHERE id = ${q.couponId}::uuid AND (usage_limit IS NULL OR used_count < usage_limit)`;
  if (updated !== 1) throw conflict("This coupon has just been fully used.");
  await tx.couponRedemption.create({ data: { couponId: q.couponId, orderId: order.id, customerId: order.customerId, phone: order.phone, amount } });
}

/** Give a coupon use back when its order is cancelled. */
export async function reverseCoupon(tx: Db, orderId: string) {
  const r = await tx.couponRedemption.findUnique({ where: { orderId } });
  if (!r || r.reversedAt) return;
  await tx.couponRedemption.update({ where: { id: r.id }, data: { reversedAt: new Date() } });
  await tx.$executeRaw`UPDATE coupons SET used_count = greatest(used_count - 1, 0), updated_at = now() WHERE id = ${r.couponId}::uuid`;
}
