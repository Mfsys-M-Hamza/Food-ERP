import "server-only";
import { z } from "zod";
import { AppError, isAppError } from "./errors";
import { Prisma } from "./db";
import { logger } from "./logger";

/**
 * Uniform result for Server Actions. Actions never throw to the client; they
 * return `{ ok: false, error }` with a safe message and optional field errors.
 */
export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; code: string; fieldErrors?: Record<string, string[]> };

export function zodFieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/** Convert any thrown error into a safe ActionResult. */
export function toActionError(error: unknown): ActionResult<never> {
  if (isAppError(error)) {
    return { ok: false, error: error.message, code: error.code, fieldErrors: error.fieldErrors };
  }
  if (error instanceof z.ZodError) {
    return {
      ok: false,
      error: "Please correct the highlighted fields.",
      code: "VALIDATION_FAILED",
      fieldErrors: zodFieldErrors(error),
    };
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return { ok: false, error: "A record with the same unique value already exists.", code: "CONFLICT" };
  }
  logger.error({ err: error }, "Unhandled action error");
  return { ok: false, error: "Something went wrong. Please try again.", code: "INTERNAL" };
}

/** Run an action body and convert errors. Usage: `return runAction(async () => {...})`. */
export async function runAction<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message };
  } catch (error) {
    // Let Next.js navigation (redirect / notFound) propagate.
    if (isNextControlFlow(error)) throw error;
    return toActionError(error);
  }
}

function isNextControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") || digest === "NEXT_NOT_FOUND");
}

export { AppError };
