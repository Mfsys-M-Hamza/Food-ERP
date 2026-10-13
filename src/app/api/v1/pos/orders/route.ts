import { apiHandler } from "@/server/core/api";
import { listOrders } from "@/server/modules/orders/service";

/** POS order panel: ?scope=active|today&q= */
export const GET = apiHandler(async (req, ctx) => {
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") === "active" ? "active" : "today";
  return listOrders(ctx, { scope, q: url.searchParams.get("q") ?? undefined });
});
