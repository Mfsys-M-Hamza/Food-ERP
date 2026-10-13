import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "@/generated/prisma/client";
import { env } from "./env";

export { Prisma };

/** Prisma transaction client type, passed to services that run inside a transaction. */
export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;

function createClient() {
  const adapter = new PrismaPg({ connectionString: env().DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: env().NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

// Reuse one client across hot reloads in development.
const globalForDb = globalThis as unknown as { __prisma?: PrismaClient };
export const db: PrismaClient = globalForDb.__prisma ?? createClient();
if (env().NODE_ENV !== "production") globalForDb.__prisma = db;

/**
 * Run `fn` in a database transaction. Retries on serialization failures and
 * deadlocks (Postgres 40001 / 40P01), which can happen under concurrent POS load.
 */
export async function withTransaction<T>(
  fn: (tx: Tx) => Promise<T>,
  options: { isolationLevel?: Prisma.TransactionIsolationLevel; maxRetries?: number } = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(fn, {
        isolationLevel: options.isolationLevel ?? Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 5_000,
        timeout: 15_000,
      });
    } catch (error) {
      const code =
        error instanceof Prisma.PrismaClientKnownRequestError
          ? (error.meta?.code as string | undefined) ?? error.code
          : undefined;
      const retryable = code === "P2034" || code === "40001" || code === "40P01";
      if (!retryable || attempt >= maxRetries) throw error;
      await new Promise((r) => setTimeout(r, 25 * 2 ** attempt));
    }
  }
}
