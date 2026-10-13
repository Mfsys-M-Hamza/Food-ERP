import Link from "next/link";
import type { Metadata } from "next";
import { MapPin, Phone } from "lucide-react";
import { requireStaffPage } from "@/server/core/page-guard";
import { can, canAny } from "@/server/core/rbac";
import { deliveryBoard, listUnsettledCash } from "@/server/modules/delivery/service";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { AssignRiderButton } from "@/features/delivery/assign-rider";
import { StatusBadge } from "@/features/orders/status-badge";
import { AutoRefresh } from "@/features/delivery/auto-refresh";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatMoney, money } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import type { OrderStatus } from "@/server/modules/orders/state-machine";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Deliveries" };

type CardData = Awaited<ReturnType<typeof deliveryBoard>>["waiting"][number];

function DeliveryCard({ d, canAssign }: { d: CardData; canAssign: boolean }) {
  return (
    <div className={cn("space-y-1.5 rounded-xl border bg-card p-3 text-sm", d.minutes > 45 && d.status !== "DELIVERED" && "border-destructive/50")} data-testid={`delivery-${d.displayNumber}`}>
      <div className="flex items-center justify-between gap-2">
        <Link href={`/admin/orders/${d.orderId}`} className="text-base font-semibold">
          #{d.displayNumber}
        </Link>
        <StatusBadge status={d.orderStatus as OrderStatus} />
      </div>
      <div className="font-medium">{d.recipient}</div>
      <div className="flex items-start gap-1 text-muted-foreground">
        <MapPin className="mt-0.5 size-3.5 shrink-0" />
        <span>
          {d.address}
          {d.landmark && ` (${d.landmark})`}
          {d.zone && ` · ${d.zone}`}
        </span>
      </div>
      <a href={`tel:${d.phone}`} className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
        <Phone className="size-3.5" /> {formatPhone(d.phone)}
      </a>
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <span className="tabular">
          {money(d.due).greaterThan(0) ? <Badge variant="outline">Collect {formatMoney(d.due)}</Badge> : <Badge variant="secondary">Paid</Badge>}
          <span className="ml-2 text-xs text-muted-foreground">{d.minutes} min</span>
        </span>
        {canAssign && d.status !== "DELIVERED" ? <AssignRiderButton orderId={d.orderId} currentRiderName={d.rider} /> : d.rider && <span className="text-xs text-muted-foreground">{d.rider}</span>}
      </div>
    </div>
  );
}

export default async function DeliveriesPage() {
  const ctx = await requireStaffPage("/admin/deliveries");
  if (!canAny(ctx, ["delivery.assign", "delivery.manage"])) return <AccessDenied />;
  const [board, cash] = await Promise.all([deliveryBoard(ctx), can(ctx, "delivery.settle") ? listUnsettledCash(ctx) : Promise.resolve([])]);
  const canAssign = can(ctx, "delivery.assign");
  const columns: [string, CardData[]][] = [
    ["Needs a rider", board.waiting],
    ["Assigned", board.assigned],
    ["On the road", board.onTheRoad],
    ["Delivered recently", board.done],
  ];
  return (
    <>
      <AutoRefresh seconds={20} />
      <PageHeader title="Deliveries" description="Live delivery board. Orders waiting more than 45 minutes are outlined in red. Refreshes automatically." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {columns.map(([title, items]) => (
          <section key={title} className="space-y-2 rounded-2xl bg-muted/40 p-3">
            <h2 className="flex items-center justify-between text-sm font-medium">
              {title} <Badge variant="secondary">{items.length}</Badge>
            </h2>
            {items.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">Nothing here.</p>}
            {items.map((d) => (
              <DeliveryCard key={d.orderId} d={d} canAssign={canAssign} />
            ))}
          </section>
        ))}
      </div>
      {cash.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Cash with riders</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {cash.map((r) => (
                <li key={r.riderId} className="flex items-center justify-between py-2">
                  <span>
                    {r.riderName} <span className="text-muted-foreground">· {r.deliveries.length} orders</span>
                  </span>
                  <span className="font-medium tabular">{formatMoney(r.total)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">Settle rider cash from the POS (Rider cash) so it lands in a till shift.</p>
          </CardContent>
        </Card>
      )}
    </>
  );
}
