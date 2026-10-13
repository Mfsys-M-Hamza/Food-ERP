"use server";

import { headers } from "next/headers";
import { refresh } from "next/cache";
import { runAction, type ActionResult } from "@/server/core/action";
import { requireContext } from "@/server/core/context";
import type { OrderDetail } from "@/server/modules/orders/service";
import { placeOnlineOrder, quoteOnline } from "./checkout";
import {
  registerCustomer,
  getCustomerSession,
  requireCustomer,
  addMyAddress,
  deleteMyAddress,
  toggleFavorite,
  updateMyProfile,
  getMyOrderLines,
} from "./account";
import { setOnlinePause } from "./store";
import { requestPhoneOtp, verifyPhoneOtp } from "./otp";

async function meta() {
  const h = await headers();
  return { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip"), userAgent: h.get("user-agent") };
}

export async function quoteAction(input: unknown) {
  return runAction(async () => {
    const session = await getCustomerSession();
    return quoteOnline(input, (await meta()).ip, session?.customer.id ?? null);
  });
}

/** Returns only what the confirmation step needs (tracking token, number). */
export async function checkoutAction(input: unknown): Promise<ActionResult<{ trackingToken: string; displayNumber: number; orderNumber: string }>> {
  return runAction(async () => {
    const m = await meta();
    const session = await getCustomerSession();
    const order: OrderDetail = await placeOnlineOrder(input, session ? { ctx: session.ctx, customerId: session.customer.id } : null, m);
    return { trackingToken: order.trackingToken, displayNumber: order.displayNumber, orderNumber: order.orderNumber };
  });
}

export async function registerAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await registerCustomer(input, (await meta()).ip);
    return undefined;
  }, "Account created");
}

export async function addAddressAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await addMyAddress(await requireCustomer(), input);
    refresh();
    return undefined;
  }, "Address saved");
}

export async function deleteAddressAction(id: string): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await deleteMyAddress(await requireCustomer(), String(id));
    refresh();
    return undefined;
  }, "Address removed");
}

export async function toggleFavoriteAction(productId: string, on: boolean): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await toggleFavorite(await requireCustomer(), String(productId), on === true);
    return undefined;
  });
}

export async function updateProfileAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await updateMyProfile(await requireCustomer(), input);
    refresh();
    return undefined;
  }, "Profile saved");
}

export async function reorderLinesAction(orderId: string) {
  return runAction(async () => getMyOrderLines(await requireCustomer(), String(orderId)));
}

/** POS: pause / resume online orders. */
export async function setOnlinePauseAction(minutes: number): Promise<ActionResult<{ pausedUntil: string }>> {
  return runAction(async () => setOnlinePause(await requireContext(), Number(minutes)), minutes ? "Online orders paused" : "Online orders resumed");
}

export async function requestOtpAction(): Promise<ActionResult<{ sentTo: string; via: string; devCode?: string }>> {
  return runAction(async () => {
    return requestPhoneOtp(await requireCustomer(), (await meta()).ip ?? null);
  });
}

export async function verifyOtpAction(code: string): Promise<ActionResult<{ verified: boolean; attemptsLeft: number }>> {
  return runAction(async () => {
    const r = await verifyPhoneOtp(await requireCustomer(), { code });
    if (r.verified) refresh();
    return r;
  });
}
