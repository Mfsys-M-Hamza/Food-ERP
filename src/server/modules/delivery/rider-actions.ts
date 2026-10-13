"use server";

import { refresh } from "next/cache";
import { requireContext } from "@/server/core/context";
import { runAction, type ActionResult } from "@/server/core/action";
import { assignRider, riderUpdate, settleRiderCash, listRiders, listUnsettledCash } from "./service";

export async function listRidersAction() {
  return runAction(async () => listRiders(await requireContext()));
}

export async function assignRiderAction(orderId: string, riderId: string | null): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const ctx = await requireContext();
    await assignRider(ctx, String(orderId), riderId ? String(riderId) : null);
    refresh();
    return undefined;
  }, riderId ? "Rider assigned" : "Rider removed");
}

export async function riderUpdateAction(orderId: string, input: unknown): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const ctx = await requireContext();
    await riderUpdate(ctx, String(orderId), input);
    return undefined;
  }, "Delivery updated");
}

export async function listUnsettledCashAction() {
  return runAction(async () => listUnsettledCash(await requireContext()));
}

export async function settleRiderCashAction(input: unknown) {
  return runAction(async () => {
    const ctx = await requireContext();
    return settleRiderCash(ctx, input);
  }, "Rider cash received");
}
