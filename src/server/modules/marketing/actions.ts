"use server";

import { refresh } from "next/cache";
import { requireContext } from "@/server/core/context";
import { runAction, type ActionResult } from "@/server/core/action";
import { saveCoupon, archiveCoupon } from "./coupons";
import { adjustPoints } from "./loyalty";
import { markRead } from "@/server/modules/notifications/service";

export async function saveCouponAction(id: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const r = await saveCoupon(await requireContext(), id ? String(id) : null, input);
    refresh();
    return r;
  }, "Coupon saved");
}

export async function archiveCouponAction(id: string): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await archiveCoupon(await requireContext(), String(id));
    refresh();
    return undefined;
  }, "Coupon archived");
}

export async function adjustPointsAction(customerId: string, input: unknown): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await adjustPoints(await requireContext(), String(customerId), input);
    refresh();
    return undefined;
  }, "Points updated");
}

export async function markNotificationsReadAction(id: string): Promise<ActionResult<{ updated: number }>> {
  return runAction(async () => {
    const r = await markRead(await requireContext(), id === "all" ? "all" : String(id));
    refresh();
    return r;
  });
}
