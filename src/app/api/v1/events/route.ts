import { connection } from "next/server";
import { getContextFromHeaders } from "@/server/core/context";
import { canAny } from "@/server/core/rbac";
import { createEventStream, latestEventId } from "@/server/modules/realtime/stream";

export const maxDuration = 300;

/** Server-Sent Events: live order updates for staff screens. */
export async function GET(req: Request) {
  await connection();
  const ctx = await getContextFromHeaders(req.headers);
  if (!ctx || ctx.user.kind !== "STAFF") return new Response("Unauthorized", { status: 401 });
  if (!canAny(ctx, ["kitchen.view", "pos.use", "orders.view", "delivery.rider"])) return new Response("Forbidden", { status: 403 });
  const lastId = req.headers.get("last-event-id");
  const start = lastId && /^\d+$/.test(lastId) ? BigInt(lastId) : await latestEventId();
  return new Response(createEventStream(ctx, start, req.signal), {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
