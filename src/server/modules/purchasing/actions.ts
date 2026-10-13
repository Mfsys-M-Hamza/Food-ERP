"use server";

import { refresh, updateTag } from "next/cache";
import { requireContext } from "@/server/core/context";
import { runAction, type ActionResult } from "@/server/core/action";
import { saveSupplier, savePurchaseDraft, receivePurchase, cancelPurchase, paySupplier } from "./service";

export async function saveSupplierAction(id: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const r = await saveSupplier(await requireContext(), id ? String(id) : null, input);
    refresh();
    return r;
  }, "Supplier saved");
}

export async function savePurchaseAction(id: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const r = await savePurchaseDraft(await requireContext(), id ? String(id) : null, input);
    refresh();
    return r;
  }, "Purchase saved");
}

export async function receivePurchaseAction(id: string): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await receivePurchase(await requireContext(), String(id));
    updateTag("menu");
    refresh();
    return undefined;
  }, "Goods received — stock updated");
}

export async function cancelPurchaseAction(id: string, reason: string): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await cancelPurchase(await requireContext(), String(id), String(reason ?? "").slice(0, 200));
    refresh();
    return undefined;
  }, "Purchase cancelled");
}

export async function paySupplierAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const r = await paySupplier(await requireContext(), input);
    refresh();
    return r;
  }, "Payment recorded");
}
