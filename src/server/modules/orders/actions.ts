"use server";

import { refresh } from "next/cache";
import { requireContext } from "@/server/core/context";
import { runAction, type ActionResult } from "@/server/core/action";
import { validationFailed } from "@/server/core/errors";
import {
  createOrder,
  addPayment,
  transitionOrder,
  cancelOrder,
  refundOrder,
  quoteOrder,
  type OrderDetail,
} from "./service";
import { holdCart, takeHeld, discardHeld } from "./held";
import type { OrderStatus } from "./state-machine";
import type { CreateOrderInput } from "./schemas";

const STATUSES: OrderStatus[] = ["ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "COMPLETED"];

export async function placeOrderAction(input: unknown): Promise<ActionResult<OrderDetail>> {
  return runAction(async () => {
    const ctx = await requireContext();
    return createOrder(ctx, input, { channel: "POS" });
  }, "Order placed");
}

export async function quoteOrderAction(input: CreateOrderInput) {
  return runAction(async () => {
    const ctx = await requireContext();
    return quoteOrder(ctx, input, "POS");
  });
}

export async function addPaymentAction(orderId: string, input: unknown): Promise<ActionResult<OrderDetail>> {
  return runAction(async () => {
    const ctx = await requireContext();
    const r = await addPayment(ctx, String(orderId), input);
    refresh();
    return r;
  }, "Payment recorded");
}

export async function transitionOrderAction(
  orderId: string,
  to: string,
  opts: { expectedVersion?: number; source?: string } = {},
): Promise<ActionResult<OrderDetail>> {
  return runAction(async () => {
    if (!STATUSES.includes(to as OrderStatus)) throw validationFailed({ to: ["Unknown status"] });
    const ctx = await requireContext();
    const r = await transitionOrder(ctx, String(orderId), to as OrderStatus, {
      expectedVersion: typeof opts.expectedVersion === "number" ? opts.expectedVersion : undefined,
      source: ["POS", "KDS", "ADMIN", "RIDER"].includes(String(opts.source)) ? String(opts.source) : "ADMIN",
    });
    refresh();
    return r;
  }, "Order updated");
}

export async function cancelOrderAction(orderId: string, input: unknown): Promise<ActionResult<OrderDetail>> {
  return runAction(async () => {
    const ctx = await requireContext();
    const r = await cancelOrder(ctx, String(orderId), input);
    refresh();
    return r;
  }, "Order cancelled");
}

export async function refundOrderAction(orderId: string, input: unknown): Promise<ActionResult<OrderDetail>> {
  return runAction(async () => {
    const ctx = await requireContext();
    const r = await refundOrder(ctx, String(orderId), input);
    refresh();
    return r;
  }, "Refund recorded");
}

export async function holdCartAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireContext();
    const r = await holdCart(ctx, input);
    return { id: r.id };
  }, "Order held");
}

export async function takeHeldAction(id: string): Promise<ActionResult<Record<string, unknown>>> {
  return runAction(async () => {
    const ctx = await requireContext();
    return takeHeld(ctx, String(id));
  });
}

export async function discardHeldAction(id: string): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const ctx = await requireContext();
    await discardHeld(ctx, String(id));
    return undefined;
  }, "Held order discarded");
}
