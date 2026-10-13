import { apiHandler } from "@/server/core/api";
import { listKitchenTickets } from "@/server/modules/kitchen/service";

export const GET = apiHandler(async (_req, ctx) => listKitchenTickets(ctx));
