import type { PermissionKey } from "@/lib/rbac/catalog";

export type OrderStatus =
  | "NEW"
  | "ACCEPTED"
  | "PREPARING"
  | "READY"
  | "OUT_FOR_DELIVERY"
  | "COMPLETED"
  | "CANCELLED"
  | "REFUNDED";
export type OrderTypeName = "TAKEAWAY" | "DELIVERY" | "DINE_IN";

/**
 * Allowed transitions. CANCELLED and REFUNDED are reached only through the
 * cancel / refund services (which enforce their own permissions and money rules).
 */
const NEXT: Record<OrderStatus, OrderStatus[]> = {
  NEW: ["ACCEPTED", "CANCELLED"],
  ACCEPTED: ["PREPARING", "READY", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: ["OUT_FOR_DELIVERY", "COMPLETED", "CANCELLED"],
  OUT_FOR_DELIVERY: ["COMPLETED", "CANCELLED"],
  COMPLETED: ["REFUNDED"],
  CANCELLED: [],
  REFUNDED: [],
};

/** Who may move an order INTO a status (any one permission suffices). */
export const TRANSITION_PERMISSIONS: Record<OrderStatus, PermissionKey[]> = {
  NEW: [],
  ACCEPTED: ["orders.accept", "kitchen.update"],
  PREPARING: ["kitchen.update", "orders.accept"],
  READY: ["kitchen.update", "orders.accept"],
  OUT_FOR_DELIVERY: ["delivery.assign", "delivery.rider"],
  COMPLETED: ["orders.create", "delivery.rider"],
  CANCELLED: ["orders.cancel"],
  REFUNDED: ["orders.refund"],
};

export function canTransition(from: OrderStatus, to: OrderStatus, type: OrderTypeName): boolean {
  if (!NEXT[from].includes(to)) return false;
  if (to === "OUT_FOR_DELIVERY" && type !== "DELIVERY") return false;
  if (from === "READY" && to === "COMPLETED" && type === "DELIVERY") return false; // must go out for delivery first
  return true;
}

export function nextStatuses(from: OrderStatus, type: OrderTypeName): OrderStatus[] {
  return NEXT[from].filter((to) => to !== "CANCELLED" && to !== "REFUNDED" && canTransition(from, to, type));
}

export const ACTIVE_STATUSES: OrderStatus[] = ["NEW", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY"];
export const KITCHEN_STATUSES: OrderStatus[] = ["NEW", "ACCEPTED", "PREPARING", "READY"];
export const FINAL_STATUSES: OrderStatus[] = ["COMPLETED", "CANCELLED", "REFUNDED"];

export const STATUS_LABEL: Record<OrderStatus, string> = {
  NEW: "New",
  ACCEPTED: "Accepted",
  PREPARING: "Preparing",
  READY: "Ready",
  OUT_FOR_DELIVERY: "Out for delivery",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

/** Timestamp column set when entering a status. */
export const STATUS_TIMESTAMP: Partial<Record<OrderStatus, "acceptedAt" | "preparingAt" | "readyAt" | "completedAt" | "cancelledAt">> = {
  ACCEPTED: "acceptedAt",
  PREPARING: "preparingAt",
  READY: "readyAt",
  COMPLETED: "completedAt",
  CANCELLED: "cancelledAt",
};
