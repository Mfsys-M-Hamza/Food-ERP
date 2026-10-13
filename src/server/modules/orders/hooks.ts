import "server-only";
import type { Tx } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";

/**
 * Side effects that run inside the order transaction when the status changes.
 * Modules register here (inventory deduction in Phase 6, loyalty in Phase 9)
 * so the order service stays independent of them.
 */
export type StatusChange = {
  orderId: string;
  from: string | null;
  to: string;
  ctx: Ctx | null;
};

type Hook = (tx: Tx, change: StatusChange) => Promise<void>;
const hooks: Hook[] = [];

export function onOrderStatusChange(hook: Hook) {
  hooks.push(hook);
}

export async function runStatusHooks(tx: Tx, change: StatusChange) {
  for (const h of hooks) await h(tx, change);
}
