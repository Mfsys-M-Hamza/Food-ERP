import "server-only";
import type { Ctx } from "@/server/core/context";
import { authorizeAny } from "@/server/core/rbac";
import { getSetting } from "@/server/modules/settings/service";
import { loadOrderDetail } from "./service";

/**
 * Neutral receipt model. The browser renderer (/print/receipt) uses it today;
 * an ESC/POS renderer can use the same model later without touching orders.
 */
export async function getReceiptModel(ctx: Ctx, orderId: string) {
  authorizeAny(ctx, ["orders.view", "orders.reprint", "kitchen.view"]);
  const [order, profile, receipt, finance] = await Promise.all([
    loadOrderDetail(orderId),
    getSetting("business.profile"),
    getSetting("receipt"),
    getSetting("finance"),
  ]);
  return { order, profile, receipt, finance };
}

export type ReceiptModel = Awaited<ReturnType<typeof getReceiptModel>>;
