import { z } from "zod";
import { apiHandler } from "@/server/core/api";
import { logger } from "@/server/core/logger";
import { myNotifications, markRead } from "@/server/modules/notifications/service";
import { runJobs } from "@/server/modules/notifications/dispatcher";

/** The bell menu polls this. It also nudges the background jobs (throttled), so alerts flow even without a cron. */
export const GET = apiHandler(async (req, ctx) => {
  await runJobs().catch((err) => logger.error({ err }, "Background jobs failed"));
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? 10);
  return myNotifications(ctx, { limit: Number.isFinite(limit) ? limit : 10 });
});

const body = z.object({ id: z.union([z.uuid(), z.literal("all")]) });

export const POST = apiHandler(async (req, ctx) => markRead(ctx, body.parse(await req.json()).id));
