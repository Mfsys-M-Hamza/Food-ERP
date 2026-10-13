import { STATUS_LABEL, type OrderStatus } from "@/server/modules/orders/state-machine";

const STATUS_TONE: Record<OrderStatus, string> = {
  NEW: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  ACCEPTED: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
  PREPARING: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  READY: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  OUT_FOR_DELIVERY: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  COMPLETED: "bg-muted text-muted-foreground",
  CANCELLED: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  REFUNDED: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>;
}

const PAY_TONE: Record<string, string> = {
  PAID: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  UNPAID: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  PARTIALLY_PAID: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  PARTIALLY_REFUNDED: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  REFUNDED: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
};
const PAY_LABEL: Record<string, string> = { PAID: "Paid", UNPAID: "Unpaid", PARTIALLY_PAID: "Part paid", PARTIALLY_REFUNDED: "Part refunded", REFUNDED: "Refunded" };

export function PaymentBadge({ status }: { status: string }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${PAY_TONE[status] ?? ""}`}>{PAY_LABEL[status] ?? status}</span>;
}
