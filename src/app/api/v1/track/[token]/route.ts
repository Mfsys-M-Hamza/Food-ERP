import { apiHandler } from "@/server/core/api";
import { notFound } from "@/server/core/errors";
import { consumeThrottle } from "@/server/core/throttle";
import { getTracking } from "@/server/modules/storefront/checkout";

/** Public order tracking by secret token (no personal details). */
export const GET = apiHandler<{ token: string }>(
  async (req, _ctx, params) => {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    await consumeThrottle(`track:${ip}`, 120, 60);
    const t = await getTracking(params.token);
    if (!t) throw notFound("Order");
    return t;
  },
  { auth: false },
);
