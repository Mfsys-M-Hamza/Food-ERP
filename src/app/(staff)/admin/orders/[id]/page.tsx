import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, MapPin, Phone } from "lucide-react";
import { z } from "zod";
import { requireStaffPage } from "@/server/core/page-guard";
import { can } from "@/server/core/rbac";
import { isAppError } from "@/server/core/errors";
import { getOrder } from "@/server/modules/orders/service";
import { STATUS_LABEL, nextStatuses } from "@/server/modules/orders/state-machine";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { StatusBadge, PaymentBadge } from "@/features/orders/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatMoney, money } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { OrderActions } from "./order-actions";
import { AssignRiderButton } from "@/features/delivery/assign-rider";

export const metadata: Metadata = { title: "Order" };

const TYPE: Record<string, string> = { TAKEAWAY: "Takeaway", DELIVERY: "Delivery", DINE_IN: "Dine-in" };
const METHOD: Record<string, string> = { CASH: "Cash", CARD: "Card", ONLINE: "Online", WALLET: "Wallet", LOYALTY: "Points" };

export default async function OrderPage({ params }: PageProps<"/admin/orders/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await requireStaffPage(`/admin/orders/${id}`);
  if (!can(ctx, "orders.view")) return <AccessDenied />;
  const o = await getOrder(ctx, id).catch((e) => {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  });

  const totals: [string, string][] = [
    ["Subtotal", o.subtotal],
    ...(money(o.discountTotal).greaterThan(0) ? ([["Discount", `-${o.discountTotal}`]] as [string, string][]) : []),
    ...(money(o.serviceCharge).greaterThan(0) ? ([["Service charge", o.serviceCharge]] as [string, string][]) : []),
    ...(money(o.taxTotal).greaterThan(0) ? ([[`Tax ${o.taxRate}%${o.taxInclusive ? " (included)" : ""}`, o.taxTotal]] as [string, string][]) : []),
    ...(money(o.deliveryCharge).greaterThan(0) ? ([["Delivery", o.deliveryCharge]] as [string, string][]) : []),
    ...(!money(o.roundingAdjustment).isZero() ? ([["Rounding", o.roundingAdjustment]] as [string, string][]) : []),
  ];

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link href="/admin/orders">
          <ArrowLeft /> Orders
        </Link>
      </Button>
      <PageHeader
        title={`Order #${o.displayNumber}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {o.orderNumber} · {formatDateTime(o.createdAt)} · {TYPE[o.type]} · {o.source}
            <StatusBadge status={o.status} />
            <PaymentBadge status={o.paymentStatus} />
          </span>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Items</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ul className="divide-y">
                {o.items.map((i) => (
                  <li key={i.id} className="flex justify-between gap-4 py-2.5">
                    <div>
                      <div className="font-medium">
                        {i.quantity} × {i.productName}
                        {i.variantName && <span className="text-muted-foreground"> · {i.variantName}</span>}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {[...i.addons.map((a) => `+ ${a.name} (${formatMoney(a.unitPrice)})`), ...i.removals.map((r) => r.label), i.note && `“${i.note}”`]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                    <div className="text-right tabular">{formatMoney(i.lineTotal)}</div>
                  </li>
                ))}
              </ul>
              <dl className="space-y-1 border-t pt-3 text-sm">
                {totals.map(([k, v]) => (
                  <div key={k} className="flex justify-between text-muted-foreground">
                    <dt>{k}</dt>
                    <dd className="tabular">{formatMoney(v)}</dd>
                  </div>
                ))}
                <div className="flex justify-between pt-1 text-base font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular">{formatMoney(o.grandTotal)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Paid</dt>
                  <dd className="tabular">{formatMoney(o.amountPaid)}</dd>
                </div>
                {money(o.amountRefunded).greaterThan(0) && (
                  <div className="flex justify-between text-destructive">
                    <dt>Refunded</dt>
                    <dd className="tabular">-{formatMoney(o.amountRefunded)}</dd>
                  </div>
                )}
                {money(o.balanceDue).greaterThan(0) && !["CANCELLED", "REFUNDED"].includes(o.status) && (
                  <div className="flex justify-between font-medium text-destructive">
                    <dt>Balance due</dt>
                    <dd className="tabular">{formatMoney(o.balanceDue)}</dd>
                  </div>
                )}
                {can(ctx, "reports.financial") && (
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <dt>Estimated food cost</dt>
                    <dd className="tabular">{formatMoney(o.estimatedCostTotal)}</dd>
                  </div>
                )}
              </dl>
              {(o.kitchenNote || o.customerNote) && (
                <div className="rounded-lg bg-muted/50 p-3 text-sm">
                  {o.kitchenNote && <p>Kitchen note: {o.kitchenNote}</p>}
                  {o.customerNote && <p>Customer note: {o.customerNote}</p>}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payments & refunds</CardTitle>
            </CardHeader>
            <CardContent>
              {o.payments.length === 0 && o.refunds.length === 0 && <p className="text-sm text-muted-foreground">No payments yet.</p>}
              <ul className="divide-y text-sm">
                {o.payments.map((p) => (
                  <li key={p.id} className="flex justify-between gap-4 py-2">
                    <span>
                      {METHOD[p.method]}
                      {p.reference && <span className="text-muted-foreground"> · ref {p.reference}</span>}
                      <span className="block text-xs text-muted-foreground">
                        {formatDateTime(p.createdAt)} · {p.receivedBy ?? "—"}
                        {p.tendered && ` · received ${formatMoney(p.tendered)}, change ${formatMoney(p.changeGiven ?? "0")}`}
                      </span>
                    </span>
                    <span className="tabular">{formatMoney(p.amount)}</span>
                  </li>
                ))}
                {o.refunds.map((r) => (
                  <li key={r.id} className="flex justify-between gap-4 py-2 text-destructive">
                    <span>
                      Refund {r.refundNumber} · {METHOD[r.method]}
                      <span className="block text-xs text-muted-foreground">
                        {formatDateTime(r.createdAt)} · {r.by ?? "—"}
                        {r.approvedBy && ` · approved by ${r.approvedBy}`} · {r.reason}
                      </span>
                    </span>
                    <span className="tabular">-{formatMoney(r.amount)}</span>
                  </li>
                ))}
              </ul>
              {o.discounts.length > 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Discount: {o.discounts.map((d) => `${formatMoney(d.amount)}${d.percent ? ` (${d.percent}%)` : ""}${d.reason ? ` — ${d.reason}` : ""}`).join(", ")}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="relative space-y-3 border-l pl-5" data-testid="order-timeline">
                {o.history.map((h, i) => (
                  <li key={i} className="relative text-sm">
                    <span className="absolute -left-[25px] top-1.5 size-2.5 rounded-full bg-brand ring-4 ring-card" />
                    <span className="font-medium">{STATUS_LABEL[h.to]}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {formatDateTime(h.at)} · {h.by} ({h.source})
                    </span>
                    {h.reason && <div className="text-muted-foreground">{h.reason}</div>}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <OrderActions
            order={{
              id: o.id,
              displayNumber: o.displayNumber,
              status: o.status,
              type: o.type,
              balanceDue: o.balanceDue,
              refundable: money(o.amountPaid).minus(o.amountRefunded).toFixed(2),
              version: o.version,
              terminalId: o.terminalId,
            }}
            next={nextStatuses(o.status, o.type)}
            canRefund={can(ctx, "orders.refund")}
            canCancel={can(ctx, "orders.cancel")}
            canTakePayment={can(ctx, "orders.create")}
          />
          <Card>
            <CardHeader>
              <CardTitle>Customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {o.customer ? (
                <Link href={`/admin/customers/${o.customer.id}`} className="font-medium underline-offset-4 hover:underline">
                  {o.customer.name}
                </Link>
              ) : (
                <div className="font-medium">{o.customerName ?? "Walk-in"}</div>
              )}
              {o.customerPhone && (
                <a href={`tel:${o.customerPhone}`} className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="size-4" /> {formatPhone(o.customerPhone)}
                </a>
              )}
              {o.customer && <div className="text-muted-foreground">{o.customer.totalOrders} orders in total</div>}
              {o.tableLabel && <div>Table {o.tableLabel}</div>}
            </CardContent>
          </Card>
          {o.delivery && (
            <Card>
              <CardHeader>
                <CardTitle>Delivery</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex gap-2">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-brand" />
                  <span>
                    {o.delivery.addressText}
                    {o.delivery.landmark && <span className="block text-muted-foreground">Near {o.delivery.landmark}</span>}
                  </span>
                </div>
                {o.delivery.zoneName && <div className="text-muted-foreground">Area: {o.delivery.zoneName}</div>}
                {o.delivery.mapUrl && (
                  <a href={o.delivery.mapUrl} target="_blank" rel="noopener noreferrer" className="text-brand underline">
                    Open map
                  </a>
                )}
                <div className="flex items-center gap-2 text-muted-foreground">
                  Rider:
                  {can(ctx, "delivery.assign") && !["COMPLETED", "CANCELLED", "REFUNDED", "OUT_FOR_DELIVERY"].includes(o.status) ? (
                    <AssignRiderButton orderId={o.id} currentRiderName={o.delivery.rider?.name} />
                  ) : (
                    <span>{o.delivery.rider?.name ?? "Not assigned"}</span>
                  )}
                </div>
                {money(o.delivery.codAmount).greaterThan(0) && <div>Cash to collect: {formatMoney(o.delivery.codAmount)}</div>}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
