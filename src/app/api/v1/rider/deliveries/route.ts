import { apiHandler } from "@/server/core/api";
import { listMyDeliveries } from "@/server/modules/delivery/service";

/** The signed-in rider's deliveries: ?scope=active|today */
export const GET = apiHandler(async (req, ctx) =>
  listMyDeliveries(ctx, new URL(req.url).searchParams.get("scope") === "today" ? "today" : "active"),
);
