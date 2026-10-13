import Link from "next/link";
import type { Metadata } from "next";
import { requireCustomer, listMyOrders } from "@/server/modules/storefront/account";
import { StatusBadge } from "@/features/orders/status-badge";
import { ReorderButton } from "@/features/storefront/account-nav";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import type { OrderStatus } from "@/server/modules/orders/state-machine";

export const metadata: Metadata = { title: "My orders", robots: { index: false } };

export default async function MyOrdersPage() {
  const orders = await listMyOrders(await requireCustomer());
  if (orders.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        No orders yet.{" "}
        <Link className="font-medium text-brand" href="/menu">
          Order now
        </Link>
      </div>
    );
  }
  return (
    <ul className="space-y-3" data-testid="my-orders">
      {orders.map((o) => (
        <li key={o.id} className="rounded-2xl border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{o.orderNumber}</span>
            <StatusBadge status={o.status as OrderStatus} />
            <span className="ml-auto font-semibold tabular">{formatMoney(o.grandTotal)}</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatDateTime(o.createdAt)} · {o.summary}
          </p>
          <div className="mt-3 flex gap-2">
            <Button asChild size="sm" variant="ghost">
              <Link href={`/order/${o.trackingToken}`}>Track / details</Link>
            </Button>
            <ReorderButton orderId={o.id} />
          </div>
        </li>
      ))}
    </ul>
  );
}
