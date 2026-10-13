import { z } from "zod";

/** Shared (client + server) validation for orders and payments. */

const money = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,2})?$/, "Enter a valid amount");

export const orderLineSchema = z.object({
  productId: z.uuid(),
  variantId: z.uuid().nullable().optional(),
  quantity: z.number().int().min(1, "At least 1").max(99, "At most 99"),
  addonIds: z.array(z.uuid()).max(30).default([]),
  removableIds: z.array(z.uuid()).max(20).default([]),
  note: z.string().trim().max(140).optional().default(""),
});
export type OrderLineInput = z.input<typeof orderLineSchema>;

export const paymentInputSchema = z.object({
  method: z.enum(["CASH", "CARD", "ONLINE"]),
  amount: money,
  tendered: money.optional(),
  reference: z.string().trim().max(80).optional(),
});
export type PaymentInput = z.input<typeof paymentInputSchema>;

export const discountInputSchema = z.object({
  type: z.enum(["PERCENT", "AMOUNT"]),
  value: money,
  reason: z.string().trim().max(120).optional().default(""),
});

export const createOrderSchema = z
  .object({
    clientRequestId: z.string().trim().min(8).max(64),
    source: z.enum(["POS", "PHONE", "ADMIN", "WEBSITE", "PWA", "AGGREGATOR"]),
    type: z.enum(["TAKEAWAY", "DELIVERY", "DINE_IN"]),
    tableLabel: z.string().trim().max(20).optional().default(""),
    customerId: z.uuid().nullable().optional(),
    customer: z
      .object({
        name: z.string().trim().max(80).optional().default(""),
        phone: z.string().trim().max(20).optional().default(""),
      })
      .optional(),
    delivery: z
      .object({
        zoneId: z.uuid().nullable().optional(),
        addressLine: z.string().trim().min(5, "Enter the delivery address").max(300),
        area: z.string().trim().max(80).optional().default(""),
        landmark: z.string().trim().max(120).optional().default(""),
        mapUrl: z.string().trim().max(500).optional().default(""),
        latitude: z.number().min(-90).max(90).nullable().optional(),
        longitude: z.number().min(-180).max(180).nullable().optional(),
        saveAddress: z.boolean().optional().default(true),
      })
      .optional(),
    items: z.array(orderLineSchema).min(1, "Add at least one item").max(100),
    discount: discountInputSchema.nullable().optional(),
    couponCode: z.string().trim().max(40).optional().default(""),
    redeemPoints: z.number().int().min(0).max(1_000_000).optional().default(0),
    kitchenNote: z.string().trim().max(300).optional().default(""),
    customerNote: z.string().trim().max(300).optional().default(""),
    payments: z.array(paymentInputSchema).max(5).default([]),
    terminalId: z.uuid().nullable().optional(),
    overridePin: z.string().trim().max(6).optional(),
    scheduledFor: z.iso.datetime().nullable().optional(),
    /** Set by the POS for sales taken while offline (when the sale really happened). */
    offlineCreatedAt: z.iso.datetime().optional(),
  })
  .superRefine((o, ctx) => {
    if (o.type === "DELIVERY" && !o.delivery) {
      ctx.addIssue({ code: "custom", path: ["delivery"], message: "Delivery address is required" });
    }
  });
export type CreateOrderInput = z.input<typeof createOrderSchema>;

export const refundInputSchema = z.object({
  amount: money,
  method: z.enum(["CASH", "CARD", "ONLINE"]),
  reason: z.string().trim().min(3, "Give a reason").max(200),
  restock: z.boolean().optional().default(false),
  terminalId: z.uuid().nullable().optional(),
  overridePin: z.string().trim().max(6).optional(),
});

export const cancelInputSchema = z.object({
  reason: z.string().trim().min(3, "Give a reason").max(200),
  terminalId: z.uuid().nullable().optional(),
  overridePin: z.string().trim().max(6).optional(),
});

export const addPaymentSchema = z.object({
  clientRequestId: z.string().trim().min(8).max(64),
  payments: z.array(paymentInputSchema).min(1).max(5),
  terminalId: z.uuid().nullable().optional(),
});
