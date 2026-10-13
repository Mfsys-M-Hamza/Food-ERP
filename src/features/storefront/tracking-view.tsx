"use client";

import { useQuery } from "@tanstack/react-query";
import { Bike, Check, ChefHat, CircleCheckBig, ClipboardCheck, PartyPopper, ShoppingBag, XCircle } from "lucide-react";
import type { Tracking } from "@/server/modules/storefront/checkout";
import { apiGet } from "@/lib/api-client";
import { formatMoney, money } from "@/lib/money";
import { cn } from "@/lib/utils";

const FINAL = ["COMPLETED", "CANCELLED", "REFUNDED"];

function steps(type: string) {
  return [
    { key: "NEW", label: "Order received", icon: ClipboardCheck },
    { key: "ACCEPTED", label: "Confirmed by the restaurant", icon: Check },
    { key: "PREPARING", label: "Being prepared", icon: ChefHat },
    { key: "READY", label: type === "DELIVERY" ? "Ready, waiting for rider" : "Ready to collect", icon: ShoppingBag },
    ...(type === "DELIVERY" ? [{ key: "OUT_FOR_DELIVERY", label: "On the way", icon: Bike }] : []),
    { key: "COMPLETED", label: type === "DELIVERY" ? "Delivered" : "Collected", icon: CircleCheckBig },
  ];
}

function time(d: string | Date | null) {
  if (!d) return "";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Karachi" }).format(new Date(d));
}

export function TrackingView({ token, initial, isNew, phone, whatsapp }: { token: string; initial: Tracking; isNew: boolean; phone: string; whatsapp: string }) {
  const q = useQuery({
    queryKey: ["track", token],
    queryFn: () => apiGet<Tracking>(`/api/v1/track/${token}`),
    initialData: initial,
    refetchInterval: (query) => (FINAL.includes(query.state.data?.status ?? "") ? false : 10_000),
  });
  const t = q.data!;
  const flow = steps(t.type);
  const reached = new Set(t.history.map((h) => h.status));
  const currentIndex = Math.max(...flow.map((s, i) => (reached.has(s.key as never) ? i : -1)));
  const cancelled = t.status === "CANCELLED" || t.status === "REFUNDED";

  return (
    <div className="mx-auto max-w-xl space-y-6">
      {isNew && !cancelled && (
        <div className="flex items-center gap-3 rounded-2xl bg-success/10 p-4 text-success animate-in fade-in slide-in-from-top-2">
          <PartyPopper className="size-6 shrink-0" />
          <p className="font-medium">Thank you{t.customerFirstName ? `, ${t.customerFirstName}` : ""}! Your order has been placed.</p>
        </div>
      )}
      <div className="rounded-3xl border bg-card p-6 text-center">
        <div className="text-sm text-muted-foreground">Order number</div>
        <div className="text-5xl font-bold tracking-tight tabular" data-testid="tracking-number">
          #{t.displayNumber}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">{t.orderNumber}</div>
        {!cancelled && !FINAL.includes(t.status) && t.estimatedReadyAt && (
          <p className="mt-4 text-sm">
            Estimated {t.type === "DELIVERY" ? "ready for dispatch" : "ready"} around <strong>{time(t.estimatedReadyAt)}</strong>
          </p>
        )}
      </div>

      {cancelled ? (
        <div className="flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 p-5" data-testid="tracking-cancelled">
          <XCircle className="size-6 shrink-0 text-destructive" />
          <div>
            <div className="font-semibold">This order was cancelled</div>
            {t.cancelReason && <p className="text-sm text-muted-foreground">{t.cancelReason}</p>}
            <p className="mt-1 text-sm text-muted-foreground">Please call us if you have any questions.</p>
          </div>
        </div>
      ) : (
        <ol className="space-y-0 rounded-2xl border bg-card p-5" data-testid="tracking-steps">
          {flow.map((s, i) => {
            const done = i <= currentIndex;
            const current = i === currentIndex && !FINAL.includes(t.status);
            const at = t.history.find((h) => h.status === s.key)?.at ?? null;
            return (
              <li key={s.key} className="relative flex gap-4 pb-5 last:pb-0">
                {i < flow.length - 1 && <span className={cn("absolute left-[17px] top-9 h-[calc(100%-1.75rem)] w-0.5", i < currentIndex ? "bg-success" : "bg-border")} />}
                <span
                  className={cn(
                    "relative grid size-9 shrink-0 place-items-center rounded-full border-2",
                    done ? "border-success bg-success text-white" : "border-border bg-background text-muted-foreground",
                    current && "ring-4 ring-success/25",
                  )}
                >
                  <s.icon className="size-4" />
                </span>
                <div className="pt-1.5">
                  <div className={cn("font-medium", !done && "text-muted-foreground")} aria-current={current ? "step" : undefined}>
                    {s.label}
                    {s.key === "OUT_FOR_DELIVERY" && done && t.riderFirstName && ` with ${t.riderFirstName}`}
                  </div>
                  {at && <div className="text-xs text-muted-foreground">{time(at)}</div>}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <div className="rounded-2xl border bg-card p-5">
        <h2 className="mb-3 font-semibold">Your order</h2>
        <ul className="space-y-2 text-sm">
          {t.items.map((i) => (
            <li key={i.id} className="flex justify-between gap-3">
              <span>
                {i.quantity}× {i.name}
                {i.variant && ` (${i.variant})`}
                {(i.addons.length > 0 || i.removals.length > 0) && (
                  <span className="block text-xs text-muted-foreground">{[...i.addons.map((a) => `+ ${a}`), ...i.removals].join(" · ")}</span>
                )}
              </span>
              <span className="tabular">{formatMoney(i.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 space-y-1 border-t pt-3 text-sm">
          {money(t.discountTotal).greaterThan(0) && (
            <div className="flex justify-between text-muted-foreground">
              <dt>Discount</dt>
              <dd className="tabular">-{formatMoney(t.discountTotal)}</dd>
            </div>
          )}
          {money(t.taxTotal).greaterThan(0) && (
            <div className="flex justify-between text-muted-foreground">
              <dt>Tax</dt>
              <dd className="tabular">{formatMoney(t.taxTotal)}</dd>
            </div>
          )}
          {money(t.deliveryCharge).greaterThan(0) && (
            <div className="flex justify-between text-muted-foreground">
              <dt>Delivery{t.area ? ` (${t.area})` : ""}</dt>
              <dd className="tabular">{formatMoney(t.deliveryCharge)}</dd>
            </div>
          )}
          <div className="flex justify-between text-base font-semibold">
            <dt>Total {t.paymentStatus === "PAID" ? "(paid)" : t.type === "DELIVERY" ? "to pay on delivery" : "to pay at pickup"}</dt>
            <dd className="tabular" data-testid="tracking-total">{formatMoney(t.grandTotal)}</dd>
          </div>
        </dl>
      </div>
      <div className="flex justify-center gap-3 text-sm">
        {phone && (
          <a className="font-medium text-brand" href={`tel:${phone.replace(/\s/g, "")}`}>
            Call the restaurant
          </a>
        )}
        {whatsapp && (
          <a className="font-medium text-brand" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer">
            WhatsApp
          </a>
        )}
      </div>
    </div>
  );
}
