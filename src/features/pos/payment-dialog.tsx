"use client";

import { useState, useTransition } from "react";
import { useQuery } from "@tanstack/react-query";
import { Banknote, CreditCard, Loader2, Smartphone, X } from "lucide-react";
import { toast } from "sonner";
import { quoteOrderAction, placeOrderAction } from "@/server/modules/orders/actions";
import { isNetworkFailure, useOnline } from "./offline-queue";
import type { OrderDetail } from "@/server/modules/orders/service";
import type { CreateOrderInput } from "@/server/modules/orders/schemas";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney, money } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Keypad } from "./pin-pad";
import { ManagerPinDialog } from "./manager-pin-dialog";

type Method = "CASH" | "CARD" | "ONLINE";
type Paid = { method: Method; amount: string; tendered?: string; reference?: string };

const METHODS: { id: Method; label: string; icon: typeof Banknote }[] = [
  { id: "CASH", label: "Cash", icon: Banknote },
  { id: "CARD", label: "Card", icon: CreditCard },
  { id: "ONLINE", label: "Online / wallet", icon: Smartphone },
];

function quickTenders(total: number) {
  const opts = new Set<number>([total]);
  for (const step of [100, 500, 1000, 5000]) opts.add(Math.ceil(total / step) * step);
  return [...opts].filter((v) => v >= total).sort((a, b) => a - b).slice(0, 5);
}

export function PaymentDialog({
  open,
  onClose,
  buildInput,
  splitEnabled,
  onPlaced,
  offlineTotal,
  onQueued,
}: {
  open: boolean;
  onClose: () => void;
  /** Builds the order request from the cart for the given payments. */
  buildInput: (payments: Paid[], overridePin?: string) => CreateOrderInput;
  splitEnabled: boolean;
  onPlaced: (order: OrderDetail, change: string) => void;
  /** Cash total worked out on this device, used when the server cannot be reached. */
  offlineTotal: string | null;
  onQueued: (input: CreateOrderInput, total: string, change: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="gap-0 p-0 sm:max-w-2xl">
        {open && <PaymentBody buildInput={buildInput} splitEnabled={splitEnabled} onPlaced={onPlaced} offlineTotal={offlineTotal} onQueued={onQueued} />}
      </DialogContent>
    </Dialog>
  );
}

function PaymentBody({
  offlineTotal,
  onQueued,
  buildInput,
  splitEnabled,
  onPlaced,
}: {
  buildInput: (payments: Paid[], overridePin?: string) => CreateOrderInput;
  splitEnabled: boolean;
  onPlaced: (order: OrderDetail, change: string) => void;
  offlineTotal: string | null;
  onQueued: (input: CreateOrderInput, total: string, change: string) => void;
}) {
  const online = useOnline();
  const [method, setMethod] = useState<Method>("CASH");
  const [paid, setPaid] = useState<Paid[]>([]);
  const [tendered, setTendered] = useState("");
  const [reference, setReference] = useState("");
  const [partial, setPartial] = useState("");
  const [pending, start] = useTransition();
  const [pinOpen, setPinOpen] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const methods = [...paid.map((p) => p.method), method];

  const quote = useQuery({
    queryKey: [
      "pos-quote",
      JSON.stringify(buildInput([]).items),
      JSON.stringify(buildInput([]).discount),
      buildInput([]).type,
      buildInput([]).delivery?.zoneId,
      buildInput([]).couponCode,
      buildInput([]).redeemPoints,
      buildInput([]).customerId,
      methods.join(),
    ],
    queryFn: async () => {
      const res = await quoteOrderAction({ ...buildInput(methods.map((m) => ({ method: m, amount: "0" }))) });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    staleTime: 0,
  });

  // Offline: only plain cash sales, priced on this device.
  const offlineMode = !quote.data && (quote.isError || !online) && !online && !!offlineTotal && method === "CASH" && paid.length === 0;
  const total = quote.data ? money(quote.data.grandTotal) : offlineMode ? money(offlineTotal!) : null;
  const paidSoFar = paid.reduce((s, p) => s.plus(p.amount), money(0));
  const remaining = total ? total.minus(paidSoFar) : null;
  const thisAmount = remaining ? (splitEnabled && partial ? money(partial) : remaining) : null;
  const tenderedValue = tendered ? money(tendered) : thisAmount;
  const change = method === "CASH" && tenderedValue && thisAmount ? tenderedValue.minus(thisAmount) : money(0);
  const cashShort = method === "CASH" && !!tenderedValue && !!thisAmount && tenderedValue.lessThan(thisAmount);

  function submit(overridePin?: string) {
    if (!thisAmount || !remaining) return;
    const current: Paid = {
      method,
      amount: thisAmount.toFixed(2),
      ...(method === "CASH" ? { tendered: (tenderedValue ?? thisAmount).toFixed(2) } : {}),
      ...(method !== "CASH" && reference ? { reference } : {}),
    };
    if (thisAmount.lessThan(remaining)) {
      // Split: keep collecting.
      setPaid([...paid, current]);
      setTendered("");
      setPartial("");
      setReference("");
      setMethod(method === "CASH" ? "CARD" : "CASH");
      return;
    }
    const all = [...paid, current];
    const cashChangeOf = (ps: Paid[]) => ps.filter((p) => p.method === "CASH").reduce((s, p) => s.plus(money(p.tendered ?? p.amount).minus(p.amount)), money(0));
    start(async () => {
      const input = buildInput(all, overridePin);
      let res;
      try {
        if (!navigator.onLine) throw new TypeError("offline");
        res = await placeOrderAction(input);
      } catch (e) {
        if (!isNetworkFailure(e)) throw e;
        if (all.every((p) => p.method === "CASH") && !input.couponCode && !input.redeemPoints) {
          onQueued({ ...input, offlineCreatedAt: new Date().toISOString() }, all.reduce((s, p) => s.plus(p.amount), money(0)).toFixed(2), cashChangeOf(all).toFixed(2));
        } else {
          toast.error("No connection. Card and online payments, coupons and points need the internet. Take cash, or try again.");
        }
        return;
      }
      if (res.ok) {
        setPinOpen(false);
        onPlaced(res.data, cashChangeOf(all).toFixed(2));
      } else if (res.fieldErrors?.overridePin || (overridePin && res.code === "PERMISSION_DENIED")) {
        setPinError(overridePin ? res.error : null);
        setPinOpen(true);
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <>
      <DialogHeader className="border-b p-5">
        <DialogTitle className="text-xl">Take payment</DialogTitle>
      </DialogHeader>
      <div className="grid gap-6 p-5 md:grid-cols-[1fr_260px]">
        <div className="space-y-5">
          <div className="rounded-2xl bg-muted/60 p-4">
            <div className="text-sm text-muted-foreground">{paid.length ? "Remaining" : "Amount due"}</div>
            {quote.isLoading || !remaining ? (
              <Skeleton className="mt-1 h-10 w-40" />
            ) : (
              <div className="text-4xl font-semibold tracking-tight tabular" data-testid="amount-due">
                {formatMoney(remaining)}
              </div>
            )}
            {quote.data && money(quote.data.tax).greaterThan(0) && (
              <div className="mt-1 text-xs text-muted-foreground">Includes tax {formatMoney(quote.data.tax)} ({quote.data.taxRate}%)</div>
            )}
            {quote.data && money(quote.data.rounding).abs().greaterThan(0) && (
              <div className="text-xs text-muted-foreground">Rounded {formatMoney(quote.data.rounding)}</div>
            )}
            {quote.isError && <p className="mt-2 text-sm text-destructive">{(quote.error as Error).message}</p>}
          </div>

          {paid.length > 0 && (
            <ul className="space-y-1 text-sm">
              {paid.map((p, i) => (
                <li key={i} className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span>{p.method === "CASH" ? "Cash" : p.method === "CARD" ? "Card" : "Online"}</span>
                  <span className="flex items-center gap-2 tabular">
                    {formatMoney(p.amount)}
                    <button type="button" onClick={() => setPaid(paid.filter((_, j) => j !== i))} aria-label="Remove payment">
                      <X className="size-4" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Payment method">
            {METHODS.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={method === m.id}
                onClick={() => {
                  setMethod(m.id);
                  setTendered("");
                }}
                className={cn(
                  "flex h-20 flex-col items-center justify-center gap-1 rounded-xl border-2 font-medium transition-colors",
                  method === m.id ? "border-brand bg-brand/10" : "border-border hover:bg-muted",
                )}
              >
                <m.icon className="size-6" />
                <span className="text-sm">{m.label}</span>
              </button>
            ))}
          </div>

          {splitEnabled && remaining && (
            <label className="block text-sm">
              <span className="text-muted-foreground">Amount for this payment (leave empty for the full remaining)</span>
              <Input className="mt-1 h-11 tabular" inputMode="decimal" value={partial} onChange={(e) => setPartial(e.target.value.replace(/[^\d.]/g, ""))} />
            </label>
          )}

          {method === "CASH" ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {thisAmount &&
                  quickTenders(thisAmount.toNumber()).map((v) => (
                    <Button key={v} type="button" variant="outline" className="h-11 tabular" onClick={() => setTendered(String(v))}>
                      {v === thisAmount.toNumber() ? "Exact" : formatMoney(v)}
                    </Button>
                  ))}
              </div>
              <div className="flex items-end justify-between rounded-xl border p-4">
                <div>
                  <div className="text-sm text-muted-foreground">Cash received</div>
                  <div className="text-2xl font-semibold tabular" data-testid="tendered">
                    {formatMoney(tenderedValue ?? 0)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-muted-foreground">Change</div>
                  <div className={cn("text-2xl font-semibold tabular", change.greaterThan(0) && "text-success")} data-testid="change-due">
                    {formatMoney(change.isNegative() ? 0 : change)}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <label className="block text-sm">
              <span className="text-muted-foreground">Reference (optional) — slip number or transaction ID</span>
              <Input className="mt-1 h-11" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} />
            </label>
          )}
        </div>

        <div className="space-y-3">
          {method === "CASH" && <Keypad value={tendered} onChange={setTendered} maxLength={9} allowDot />}
          <Button
            className="h-16 w-full text-lg"
            disabled={pending || !thisAmount || quote.isLoading || cashShort || (thisAmount && thisAmount.lessThanOrEqualTo(0) && !!remaining?.greaterThan(0))}
            onClick={() => submit()}
            data-testid="confirm-payment"
          >
            {pending ? <Loader2 className="animate-spin" /> : null}
            {thisAmount && remaining && thisAmount.lessThan(remaining) ? "Add payment" : "Complete sale"}
          </Button>
          {cashShort && <p className="text-center text-sm text-destructive">Cash received is less than the amount.</p>}
        </div>
      </div>
      <ManagerPinDialog
        open={pinOpen}
        reason="This discount is above the cashier limit."
        error={pinError}
        onCancel={() => setPinOpen(false)}
        onSubmit={(pin) => submit(pin)}
      />
    </>
  );
}
