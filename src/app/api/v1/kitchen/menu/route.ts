import { apiHandler } from "@/server/core/api";
import { authorize } from "@/server/core/rbac";
import { getCatalog } from "@/server/modules/menu/catalog";

/** Menu for the out-of-stock panel (kitchen and cashiers). */
export const GET = apiHandler(async (_req, ctx) => {
  authorize(ctx, "menu.availability");
  return getCatalog("POS");
});
