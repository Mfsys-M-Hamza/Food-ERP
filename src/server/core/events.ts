import "server-only";
import type { Db } from "./db";

/**
 * Domain events (transactional outbox). Written in the same transaction as the
 * business change; the dispatcher (src/server/modules/notifications/dispatcher)
 * publishes them after commit: realtime pings to screens and notifications.
 * Payloads carry IDs and statuses, never personal data.
 */
export type DomainEvent =
  | { type: "order.created"; orderId: string; branchId: string; status: string; source: string }
  | { type: "order.status_changed"; orderId: string; branchId: string; from: string; to: string }
  | { type: "order.paid"; orderId: string; branchId: string }
  | { type: "order.cancelled"; orderId: string; branchId: string }
  | { type: "order.refunded"; orderId: string; branchId: string; amount: string; large: boolean }
  | { type: "delivery.assigned"; orderId: string; branchId: string; riderId: string }
  | { type: "shift.closed"; shiftId: string; branchId: string; difference: string; outOfTolerance: boolean }
  | { type: "stock.low"; ingredientId: string; branchId: string }
  | { type: "menu.availability_changed"; productId: string; available: boolean }
  | { type: "purchase.payment_due"; purchaseId: string; branchId: string };

export async function emit(tx: Db, event: DomainEvent): Promise<void> {
  await tx.outboxEvent.create({ data: { type: event.type, payload: event as object } });
}
