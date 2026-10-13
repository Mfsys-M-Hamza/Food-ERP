import "server-only";
import type { Db } from "./db";

/**
 * Atomically allocate the next number in a sequence. The row lock taken by
 * INSERT … ON CONFLICT DO UPDATE serialises concurrent callers, so two orders
 * can never get the same number. Call inside the business transaction.
 */
export async function nextSequence(tx: Db, branchId: string, scope: string, periodKey: string): Promise<number> {
  const rows = await tx.$queryRaw<{ last_value: number }[]>`
    INSERT INTO number_sequences (branch_id, scope, period_key, last_value, updated_at)
    VALUES (${branchId}::uuid, ${scope}, ${periodKey}, 1, now())
    ON CONFLICT (branch_id, scope, period_key)
    DO UPDATE SET last_value = number_sequences.last_value + 1, updated_at = now()
    RETURNING last_value`;
  return Number(rows[0]!.last_value);
}

/** "EXP" + 42 → "EXP-00042". */
export function formatDocNumber(prefix: string, n: number, width = 5): string {
  return `${prefix}-${String(n).padStart(width, "0")}`;
}
