import { timingSafeEqual } from "node:crypto";
import { connection } from "next/server";
import { env } from "@/server/core/env";
import { runJobs } from "@/server/modules/notifications/dispatcher";

/**
 * Scheduled jobs (alerts, outbox dispatch, points expiry). Call with
 * `Authorization: Bearer <CRON_SECRET>` — Vercel Cron does this automatically.
 */
export async function GET(req: Request) {
  await connection();
  const secret = env().CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const ok = !!secret && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!ok) return Response.json({ error: { code: "UNAUTHENTICATED", message: "Not allowed" } }, { status: 401 });
  const result = await runJobs({ force: true });
  return Response.json({ data: result }, { headers: { "Cache-Control": "no-store" } });
}
