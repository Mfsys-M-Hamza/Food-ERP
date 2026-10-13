import { apiHandler } from "@/server/core/api";
import { listHeld } from "@/server/modules/orders/held";

export const GET = apiHandler(async (_req, ctx) => listHeld(ctx));
