import "server-only";
import { db } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";

/**
 * Live updates over Server-Sent Events, fed by the transactional outbox.
 * - Payloads are IDs and statuses only (no personal data).
 * - Only events for the viewer's branch are sent.
 * - The stream ends after ~4.5 minutes; EventSource reconnects automatically
 *   and resumes from Last-Event-ID, so nothing is missed. This keeps each
 *   serverless invocation short (Vercel max duration).
 * Screens also poll as a safety net, so live updates are an optimisation.
 */
const POLL_MS = 1500;
const MAX_MS = 270_000;
const HEARTBEAT_MS = 20_000;

export type StreamEvent = { id: string; type: string; payload: Record<string, unknown> };

/** Events after `afterId` for a branch (exported for tests). */
export async function eventsSince(branchId: string, afterId: bigint, limit = 100): Promise<StreamEvent[]> {
  const rows = await db.outboxEvent.findMany({
    where: { id: { gt: afterId } },
    orderBy: { id: "asc" },
    take: limit,
  });
  return rows
    .filter((r) => {
      const p = r.payload as { branchId?: string };
      return !p.branchId || p.branchId === branchId;
    })
    .map((r) => ({ id: r.id.toString(), type: r.type, payload: publicPayload(r.payload as Record<string, unknown>) }));
}

/** Strip anything not needed by screens. */
function publicPayload(p: Record<string, unknown>) {
  const allowed = ["orderId", "status", "from", "to", "source", "riderId", "productId", "available"];
  return Object.fromEntries(Object.entries(p).filter(([k]) => allowed.includes(k)));
}

export async function latestEventId(): Promise<bigint> {
  const last = await db.outboxEvent.findFirst({ orderBy: { id: "desc" }, select: { id: true } });
  return last?.id ?? BigInt(0);
}

export function createEventStream(ctx: Ctx, startAfter: bigint, signal: AbortSignal): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let cursor = startAfter;
  let closed = false;
  return new ReadableStream({
    async start(controller) {
      const send = (chunk: string) => {
        if (!closed) controller.enqueue(encoder.encode(chunk));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {}
      };
      signal.addEventListener("abort", close);
      send(`retry: 3000\n: connected\n\n`);
      const started = Date.now();
      let lastBeat = Date.now();
      while (!closed && Date.now() - started < MAX_MS) {
        try {
          const events = await eventsSince(ctx.branchId, cursor);
          for (const e of events) {
            send(`id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(e.payload)}\n\n`);
            cursor = BigInt(e.id);
          }
          if (events.length === 0 && Date.now() - lastBeat > HEARTBEAT_MS) {
            send(`: ping\n\n`);
            lastBeat = Date.now();
          }
        } catch {
          // Database hiccup: keep the stream; the client also polls.
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
      close();
    },
    cancel() {
      closed = true;
    },
  });
}
