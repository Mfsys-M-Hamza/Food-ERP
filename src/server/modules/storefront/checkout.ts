import "server-only";
import { z } from "zod";
import { db } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";
import { getDefaultBranchId } from "@/server/core/branch";
import { consumeThrottle } from "@/server/core/throttle";
import { AppError, validationFailed } from "@/server/core/errors";
import { zodFieldErrors } from "@/server/core/action";
import { createOrder, quoteOrder } from "@/server/modules/orders/service";
import { orderLineSchema } from "@/server/modules/orders/schemas";
import { normalizePhone } from "@/lib/phone";
import { getStoreStatus } from "./store";

/** Context for a visitor who is not signed in (online checkout). */
export async function guestContext(ip: string | null, userAgent: string | null): Promise<Ctx> {
  return {
    user: { id: "", name: "Guest", email: "", kind: "CUSTOMER" },
    roles: [],
    permissions: new Set(),
    isOwner: false,
    branchId: await getDefaultBranchId(),
    ip,
    userAgent,
    terminalId: null,
  };
}

export const checkoutSchema = z
  .object({
    clientRequestId: z.string().trim().min(8).max(64),
    channel: z.enum(["WEBSITE", "PWA"]).default("WEBSITE"),
    type: z.enum(["DELIVERY", "TAKEAWAY"]),
    name: z.string().trim().min(2, "Enter your name").max(80),
    phone: z
      .string()
      .trim()
      .refine((v) => normalizePhone(v) !== null, "Enter a valid mobile number"),
    email: z.union([z.email("Enter a valid e-mail"), z.literal("")]).optional().default(""),
    zoneId: z.uuid().nullable().optional(),
    addressLine: z.string().trim().max(300).optional().default(""),
    landmark: z.string().trim().max(120).optional().default(""),
    mapUrl: z.string().trim().max(500).optional().default(""),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    note: z.string().trim().max(300).optional().default(""),
    paymentMethod: z.enum(["CASH_ON_DELIVERY", "PAY_AT_PICKUP"]),
    items: z.array(orderLineSchema).min(1, "Your cart is empty").max(60),
    couponCode: z.string().trim().max(40).optional().default(""),
    redeemPoints: z.number().int().min(0).max(1_000_000).optional().default(0),
  })
  .superRefine((v, ctx) => {
    if (v.type === "DELIVERY" && v.addressLine.length < 5) ctx.addIssue({ code: "custom", path: ["addressLine"], message: "Enter your delivery address" });
  });
export type CheckoutInput = z.input<typeof checkoutSchema>;

/**
 * Place an online order. Guests and signed-in customers both use this.
 * Throttled per IP; refused when the store is closed or paused.
 */
export async function placeOnlineOrder(raw: unknown, session: { ctx: Ctx; customerId: string | null } | null, meta: { ip: string | null; userAgent: string | null }) {
  const r = checkoutSchema.safeParse(raw);
  if (!r.success) throw validationFailed(zodFieldErrors(r.error));
  const input = r.data;
  await consumeThrottle(`checkout:${meta.ip ?? "unknown"}`, 8, 600);

  const status = await getStoreStatus();
  if (!status.accepting) throw new AppError("INVALID_STATE", status.message ?? "We are not taking online orders right now.");

  const ctx = session?.ctx ?? (await guestContext(meta.ip, meta.userAgent));
  const phone = normalizePhone(input.phone)!;
  const customerId: string | null = session?.customerId ?? null;
  if (customerId) {
    // Keep the account's contact details current.
    await db.customer.update({ where: { id: customerId }, data: { name: input.name } }).catch(() => undefined);
    const c = await db.customer.findUnique({ where: { id: customerId }, select: { phone: true } });
    if (c && !c.phone) await db.customer.update({ where: { id: customerId }, data: { phone } }).catch(() => undefined);
  }

  return createOrder(
    ctx,
    {
      clientRequestId: input.clientRequestId,
      source: input.channel,
      type: input.type,
      customerId,
      customer: { name: input.name, phone },
      delivery:
        input.type === "DELIVERY"
          ? {
              zoneId: input.zoneId ?? null,
              addressLine: input.addressLine,
              landmark: input.landmark,
              mapUrl: input.mapUrl,
              latitude: input.latitude ?? null,
              longitude: input.longitude ?? null,
              saveAddress: !!customerId,
            }
          : undefined,
      items: input.items,
      customerNote: input.note,
      kitchenNote: input.note,
      couponCode: input.couponCode,
      // Points belong to the signed-in account only.
      redeemPoints: customerId ? input.redeemPoints : 0,
      payments: [],
    },
    { channel: "ONLINE" },
  );
}

const quoteSchema = z.object({
  type: z.enum(["DELIVERY", "TAKEAWAY"]),
  zoneId: z.uuid().nullable().optional(),
  items: z.array(orderLineSchema).min(1).max(60),
  couponCode: z.string().trim().max(40).optional().default(""),
  phone: z.string().trim().max(20).optional().default(""),
  redeemPoints: z.number().int().min(0).max(1_000_000).optional().default(0),
});

export async function quoteOnline(raw: unknown, ip: string | null, customerId: string | null = null) {
  const r = quoteSchema.safeParse(raw);
  if (!r.success) throw validationFailed(zodFieldErrors(r.error));
  // Coupon guessing is throttled harder than plain quotes.
  await consumeThrottle(`quote:${ip ?? "unknown"}`, 120, 60);
  if (r.data.couponCode) await consumeThrottle(`coupon:${ip ?? "unknown"}`, 20, 600);
  return quoteOrder(
    null,
    {
      items: r.data.items,
      type: r.data.type,
      delivery: r.data.type === "DELIVERY" ? { zoneId: r.data.zoneId ?? null, addressLine: "-----" } : undefined,
      discount: null,
      payments: [],
      couponCode: r.data.couponCode,
      customerId,
      customer: { phone: r.data.phone },
      redeemPoints: customerId ? r.data.redeemPoints : 0,
    },
    "ONLINE",
  );
}

/** Public tracking by secret token: no address or phone, only what the customer needs. */
export async function getTracking(token: string) {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(token)) return null;
  const o = await db.order.findUnique({
    where: { trackingToken: token },
    include: {
      items: { orderBy: { sortOrder: "asc" }, include: { addons: true, removals: true } },
      statusHistory: { orderBy: { createdAt: "asc" }, select: { toStatus: true, createdAt: true } },
      delivery: { select: { status: true, rider: { select: { name: true } }, zone: { select: { name: true } } } },
    },
  });
  if (!o) return null;
  return {
    orderNumber: o.orderNumber,
    displayNumber: o.displayNumber,
    status: o.status,
    type: o.type,
    createdAt: o.createdAt,
    estimatedReadyAt: o.estimatedReadyAt,
    customerFirstName: o.customerName?.split(/\s+/)[0] ?? null,
    items: o.items.map((i) => ({
      id: i.id,
      quantity: i.quantity,
      name: i.productName,
      variant: i.variantName,
      addons: i.addons.map((a) => a.addonName),
      removals: i.removals.map((x) => x.label),
      lineTotal: i.lineTotal.toFixed(2),
    })),
    subtotal: o.subtotal.toFixed(2),
    deliveryCharge: o.deliveryCharge.toFixed(2),
    discountTotal: o.discountTotal.toFixed(2),
    taxTotal: o.taxTotal.toFixed(2),
    grandTotal: o.grandTotal.toFixed(2),
    paymentStatus: o.paymentStatus,
    history: o.statusHistory.map((h) => ({ status: h.toStatus, at: h.createdAt })),
    riderFirstName: o.delivery?.rider?.name.split(/\s+/)[0] ?? null,
    area: o.delivery?.zone?.name ?? null,
    cancelReason: o.status === "CANCELLED" ? o.cancelReason : null,
  };
}
export type Tracking = NonNullable<Awaited<ReturnType<typeof getTracking>>>;
