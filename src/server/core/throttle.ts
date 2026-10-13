import "server-only";
import { db } from "./db";
import { AppError } from "./errors";

/**
 * Fixed-window throttle stored in Postgres (works across serverless instances).
 * Call OUTSIDE business transactions so failed attempts are still counted.
 */
export async function consumeThrottle(key: string, limit: number, windowSeconds: number): Promise<void> {
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO throttles (key, count, window_start) VALUES (${key}, 1, now())
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN throttles.window_start < now() - make_interval(secs => ${windowSeconds}) THEN 1 ELSE throttles.count + 1 END,
      window_start = CASE WHEN throttles.window_start < now() - make_interval(secs => ${windowSeconds}) THEN now() ELSE throttles.window_start END
    RETURNING count`;
  if (Number(rows[0]!.count) > limit) {
    throw new AppError("RATE_LIMITED", "Too many attempts. Please wait a few minutes and try again.");
  }
}

export async function resetThrottle(key: string): Promise<void> {
  await db.throttle.deleteMany({ where: { key } });
}
