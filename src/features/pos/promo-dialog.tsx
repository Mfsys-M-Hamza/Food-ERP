"use client";

import { useEffect, useState, useTransition } from "react";
import { Gift, Loader2, Ticket } from "lucide-react";
import { toast } from "sonner";
import { quoteOrderAction } from "@/server/modules/orders/actions";
import type { CreateOrderInput } from "@/server/modules/orders/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatMoney } from "@/lib/money";
import { useCart } from "./store";

type Quote = Extract<Awaited<ReturnType<typeof quoteOrderAction>>, { ok: true }>["data"];
type BuildInput = (payments: never[]) => CreateOrderInput;

/**
 * Server-priced totals while a coupon or points are applied. Re-quotes when the
 * cart changes; if the offer stops being valid (e.g. items removed below the
 * minimum) the error is shown and the offer can be removed.
 */
export function usePromoQuote(buildInput: BuildInput | null, deps: unknown[]) {
  const [state, setState] = useState<{ data: Quote | null; error: string | null }>({ data: null, error: null });
  const key = JSON.stringify(deps);
  useEffect(() => {
    if (!buildInput) {
      const t = setTimeout(() => setState({ data: null, error: null }), 0);
      return () => clearTimeout(t);
    }
    let alive = true;
    const t = setTimeout(async () => {
      const r = await quoteOrderAction(buildInput([]));
      if (!alive) return;
      setState(r.ok ? { data: r.data, error: null } : { data: null, error: r.error });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the cart snapshot in `key` is the dependency
  }, [key, !!buildInput]);
  return state;
}

export function PromoDialog({ open, onClose, buildInput, customerName }: { open: boolean; onClose: () => void; buildInput: BuildInput; customerName: string | null }) {
  const cart = useCart();
  const [code, setCode] = useState(cart.couponCode);
  const [points, setPoints] = useState(cart.redeemPoints ? String(cart.redeemPoints) : "");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Load the customer's balance when the dialog opens.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void quoteOrderAction({ ...buildInput([]), couponCode: "", redeemPoints: 0 }).then((r) => {
      if (alive && r.ok) setQuote(r.data);
    });
    return () => {
      alive = false;
    };
  }, [open, buildInput]);

  function apply(next: { couponCode: string; redeemPoints: number }) {
    start(async () => {
      const r = await quoteOrderAction({ ...buildInput([]), ...next });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      cart.setPromo(next);
      setError(null);
      toast.success(next.couponCode || next.redeemPoints ? "Offer applied" : "Offer removed");
      onClose();
    });
  }

  const loyalty = quote?.loyalty;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Coupon and points</DialogTitle>
          <DialogDescription>Checked against the rules on the server before it is applied.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="promo-code" className="flex items-center gap-1.5">
            <Ticket className="size-4" /> Coupon code
          </Label>
          <Input id="promo-code" className="h-11 font-mono uppercase placeholder:font-sans placeholder:normal-case" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. WELCOME10" />
          {cart.discount && <p className="text-xs text-muted-foreground">A coupon cannot be combined with a staff discount.</p>}
        </div>
        {loyalty?.enabled && (
          <div className="space-y-1.5 rounded-lg border p-3">
            <Label htmlFor="promo-points" className="flex items-center gap-1.5">
              <Gift className="size-4" /> Loyalty points
            </Label>
            {customerName && loyalty.balance !== null ? (
              <>
                <p className="text-sm text-muted-foreground">
                  {customerName} has <b className="text-foreground">{loyalty.balance}</b> points (minimum {loyalty.minimumRedeemPoints} to use).
                </p>
                <div className="flex gap-2">
                  <Input id="promo-points" inputMode="numeric" className="h-11" value={points} onChange={(e) => setPoints(e.target.value.replace(/\D/g, ""))} placeholder="Points to use" />
                  <Button type="button" variant="outline" className="h-11" onClick={() => setPoints(String(loyalty.balance ?? 0))}>
                    All
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Choose a saved customer first to use their points.</p>
            )}
          </div>
        )}
        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="promo-dialog-error">
            {error}
          </p>
        )}
        {quote && loyalty?.enabled && loyalty.toEarn > 0 && <p className="text-xs text-muted-foreground">This order earns about {loyalty.toEarn} points ({formatMoney(quote.grandTotal)} total).</p>}
        <DialogFooter className="gap-2">
          {(cart.couponCode || cart.redeemPoints > 0) && (
            <Button variant="ghost" className="mr-auto" disabled={pending} onClick={() => apply({ couponCode: "", redeemPoints: 0 })}>
              Remove offer
            </Button>
          )}
          <Button className="h-11" disabled={pending || (!code && !points)} onClick={() => apply({ couponCode: code.trim(), redeemPoints: Number(points || 0) })} data-testid="apply-promo">
            {pending && <Loader2 className="animate-spin" />}
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
