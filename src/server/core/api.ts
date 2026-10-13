import "server-only";
import { z } from "zod";
import { connection } from "next/server";
import { getContextFromHeaders, type Ctx } from "./context";
import { AppError, isAppError } from "./errors";
import { zodFieldErrors } from "./action";
import { logger } from "./logger";
import { Prisma } from "./db";

/**
 * Wrap a Route Handler: resolves the session context, maps errors to the
 * standard JSON envelope `{ data }` / `{ error: { code, message, fieldErrors } }`.
 */
export function apiHandler<P = unknown>(
  fn: (req: Request, ctx: Ctx, params: P) => Promise<unknown>,
  opts: { auth?: boolean } = { auth: true },
) {
  return async (req: Request, route: { params: Promise<P> }) => {
    // API responses are per-request: never prerender them at build time.
    await connection();
    try {
      const ctx = await getContextFromHeaders(req.headers);
      if (opts.auth !== false && !ctx) throw new AppError("UNAUTHENTICATED", "Please sign in.");
      const data = await fn(req, ctx as Ctx, (await route?.params) as P);
      return Response.json({ data }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      return apiError(e);
    }
  };
}

export function apiError(e: unknown) {
  // Let Next.js internal control-flow errors (redirect, dynamic bail-out) pass through.
  if (typeof (e as { digest?: unknown })?.digest === "string") throw e;
  if (isAppError(e)) {
    return Response.json(
      { error: { code: e.code, message: e.message, fieldErrors: e.fieldErrors } },
      { status: e.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (e instanceof z.ZodError) {
    return Response.json(
      { error: { code: "VALIDATION_FAILED", message: "Invalid request", fieldErrors: zodFieldErrors(e) } },
      { status: 422 },
    );
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return Response.json({ error: { code: "CONFLICT", message: "Duplicate record" } }, { status: 409 });
  }
  logger.error({ err: e }, "Unhandled API error");
  return Response.json({ error: { code: "INTERNAL", message: "Something went wrong" } }, { status: 500 });
}
