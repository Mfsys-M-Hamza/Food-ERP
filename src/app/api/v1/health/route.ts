import { db } from "@/server/core/db";

/** Liveness + database connectivity probe (no data exposed). */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ data: { status: "ok", database: "ok" } }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { error: { code: "INTERNAL", message: "Database unavailable" } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
