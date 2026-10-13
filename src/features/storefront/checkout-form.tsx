"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Banknote, Bike, Loader2, MapPin, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { checkoutAction, quoteAction } from "@/server/modules/storefront/actions";
import type { ZoneRow } from "@/server/modules/delivery/zones";
import type { StoreStatus } from "@/server/modules/storefront/store";
import { apiGet } from "@/lib/api-client";
import { useHydrated } from "@/hooks/use-hydrated";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatMoney, money } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { useShopCart, toOrderItems, lineUnit } from "./cart-store";

type Me = {
  name: string;
  phone: string | null;
  addresses: { id: string; label: string; addressLine: string; landmark: string | null; mapUrl: string | null; zoneId: string | null }[];
};

type Props = { zones: ZoneRow[]; takeawayEnabled: boolean; deliveryEnabled: boolean };

export function CheckoutForm(props: Props) {
  const hydrated = useHydrated();
  const me = useQuery({ queryKey: ["me"], queryFn: () => apiGet<Me>("/api/v1/me").catch(() => null), staleTime: 60_000 });
  if (!hydrated || me.isLoading) return <div className="h-96" />;
  return <CheckoutInner {...props} me={me.data ?? null} />;
}

function CheckoutInner({ zones, takeawayEnabled, deliveryEnabled, me }: Props & { me: Me | null }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const cart = useShopCart();
  const firstAddress = me?.addresses[0];
  const [name, setName] = useState(me?.name ?? "");
  const [phone, setPhone] = useState(me?.phone ? formatPhone(me.phone) : "");
  const [address, setAddress] = useState(firstAddress?.addressLine ?? "");
  const [landmark, setLandmark] = useState(firstAddress?.landmark ?? "");
  const [note, setNote] = useState("");
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState("");
  const [couponError, setCouponError] = useState<string | null>(null);
  const [checkingCoupon, setCheckingCoupon] = useState(false);
  const [pointsToUse, setPointsToUse] = useState(0);
  const usePoints = pointsToUse > 0;
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const type = deliveryEnabled ? (takeawayEnabled ? cart.type : "DELIVERY") : "TAKEAWAY";

  const status = useQuery({ queryKey: ["store-status"], queryFn: () => apiGet<StoreStatus>("/api/v1/store/status"), refetchInterval: 60_000 });
  // Use the saved address's area (syncs the external cart store once).
  useEffect(() => {
    if (firstAddress?.zoneId && !useShopCart.getState().zoneId) useShopCart.getState().setZone(firstAddress.zoneId);
  }, [firstAddress?.zoneId]);

  const items = toOrderItems(cart.lines);
  const quote = useQuery({
    queryKey: ["shop-quote", JSON.stringify(items), type, cart.zoneId, coupon, pointsToUse],
    enabled: hydrated && items.length > 0,
    queryFn: async () => {
      const r = await quoteAction({ type, zoneId: type === "DELIVERY" ? cart.zoneId : null, items, couponCode: coupon, phone, redeemPoints: pointsToUse });
      if (!r.ok) throw new Error(r.error);
      return r.data;
    },
  });

  if (!hydrated) return <div className="h-96" />;
  if (cart.lines.length === 0) {
    return (
      <div className="py-20 text-center">
        <p className="text-lg">Your cart is empty.</p>
        <Button asChild className="mt-4 rounded-full">
          <Link href="/menu">Back to the menu</Link>
        </Button>
      </div>
    );
  }

  const zone = zones.find((z) => z.id === cart.zoneId);
  const belowMinimum = type === "DELIVERY" && quote.data && money(quote.data.subtotal).minus(quote.data.discount).lessThan(quote.data.minimumOrder);

  async function applyCoupon() {
    const code = couponInput.trim().toUpperCase();
    if (!code) return;
    setCheckingCoupon(true);
    const r = await quoteAction({ type, zoneId: type === "DELIVERY" ? cart.zoneId : null, items, couponCode: code, phone });
    setCheckingCoupon(false);
    if (r.ok) {
      setCoupon(code);
      setCouponError(null);
      toast.success(r.data.coupon?.freeDelivery ? "Free delivery applied" : `Coupon applied: ${formatMoney(r.data.coupon?.discount ?? "0")} off`);
    } else setCouponError(r.error);
  }

  const loyalty = quote.data?.loyalty;
  const pointsAvailable = usePoints || (!!me && !!loyalty?.enabled && (loyalty.balance ?? 0) >= (loyalty.minimumRedeemPoints ?? 0) && (loyalty.balance ?? 0) > 0);

  function place() {
    setErrors({});
    start(async () => {
      const r = await checkoutAction({
        clientRequestId: cart.requestId,
        channel: window.matchMedia("(display-mode: standalone)").matches ? "PWA" : "WEBSITE",
        type,
        name,
        phone,
        zoneId: type === "DELIVERY" ? cart.zoneId : null,
        addressLine: type === "DELIVERY" ? address : "",
        landmark,
        note,
        paymentMethod: type === "DELIVERY" ? "CASH_ON_DELIVERY" : "PAY_AT_PICKUP",
        items,
        couponCode: coupon,
        redeemPoints: usePoints && loyalty ? loyalty.used : 0,
      });
      if (r.ok) {
        cart.clear();
        router.push(`/order/${r.data.trackingToken}?new=1`);
      } else {
        setErrors(r.fieldErrors ?? {});
        toast.error(r.error);
      }
    });
  }

  const err = (k: string) => errors[k]?.[0];

  return (
    <div className="grid gap-8 md:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Checkout</h1>
        {status.data && !status.data.accepting && (
          <Alert className="border-warning/50 bg-warning/10">
            <AlertDescription>
              {status.data.message} {status.data.nextOpening}
            </AlertDescription>
          </Alert>
        )}

        {deliveryEnabled && takeawayEnabled && (
          <div className="grid grid-cols-2 gap-2 rounded-2xl bg-muted p-1" role="radiogroup" aria-label="Delivery or pickup">
            {(
              [
                ["DELIVERY", "Delivery", Bike],
                ["TAKEAWAY", "Pick up", ShoppingBag],
              ] as const
            ).map(([t, label, Icon]) => (
              <button
                key={t}
                role="radio"
                aria-checked={type === t}
                onClick={() => cart.setType(t)}
                className={cn("flex h-12 items-center justify-center gap-2 rounded-xl font-medium", type === t ? "bg-background shadow" : "text-muted-foreground")}
              >
                <Icon className="size-4" /> {label}
              </button>
            ))}
          </div>
        )}

        <section className="space-y-4 rounded-2xl border bg-card p-5">
          <h2 className="font-semibold">Your details</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="co-name">Name</Label>
              <Input id="co-name" className="h-11" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" aria-invalid={!!err("name")} />
              {err("name") && <p className="text-sm text-destructive">{err("name")}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="co-phone">Mobile number</Label>
              <Input id="co-phone" className="h-11" inputMode="tel" placeholder="03xx xxxxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" aria-invalid={!!err("phone")} />
              {err("phone") && <p className="text-sm text-destructive">{err("phone")}</p>}
            </div>
          </div>
          {!me && (
            <p className="text-sm text-muted-foreground">
              Have an account?{" "}
              <Link href="/account/login?next=/checkout" className="font-medium text-brand">
                Sign in
              </Link>{" "}
              to use saved addresses.
            </p>
          )}
        </section>

        {type === "DELIVERY" && (
          <section className="space-y-4 rounded-2xl border bg-card p-5">
            <h2 className="flex items-center gap-2 font-semibold">
              <MapPin className="size-4 text-brand" /> Delivery address
            </h2>
            {me && me.addresses.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {me.addresses.map((a) => (
                  <Button
                    key={a.id}
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    onClick={() => {
                      setAddress(a.addressLine);
                      setLandmark(a.landmark ?? "");
                      cart.setZone(a.zoneId);
                    }}
                  >
                    {a.label}
                  </Button>
                ))}
              </div>
            )}
            {zones.length > 0 && (
              <div className="space-y-1.5">
                <Label>Area</Label>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Delivery area">
                  {zones.map((z) => (
                    <button
                      key={z.id}
                      role="radio"
                      aria-checked={cart.zoneId === z.id}
                      onClick={() => cart.setZone(z.id)}
                      className={cn("rounded-full border-2 px-3 py-1.5 text-sm", cart.zoneId === z.id ? "border-brand bg-brand/10" : "border-border hover:bg-muted")}
                    >
                      {z.name}
                    </button>
                  ))}
                  <button
                    role="radio"
                    aria-checked={!cart.zoneId}
                    onClick={() => cart.setZone(null)}
                    className={cn("rounded-full border-2 px-3 py-1.5 text-sm", !cart.zoneId ? "border-brand bg-brand/10" : "border-border hover:bg-muted")}
                  >
                    Other area
                  </button>
                </div>
                {zone && (
                  <p className="text-xs text-muted-foreground">
                    Delivery {formatMoney(zone.charge)} · minimum order {formatMoney(zone.minimumOrder)}
                    {zone.freeAbove && ` · free above ${formatMoney(zone.freeAbove)}`} · about {zone.estimatedMinutes} min
                  </p>
                )}
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="co-address">Full address</Label>
              <Textarea id="co-address" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="House, street, block, area" autoComplete="street-address" aria-invalid={!!err("addressLine")} />
              {err("addressLine") && <p className="text-sm text-destructive">{err("addressLine")}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="co-landmark">Nearby landmark (optional)</Label>
              <Input id="co-landmark" className="h-11" value={landmark} onChange={(e) => setLandmark(e.target.value)} />
            </div>
          </section>
        )}

        <section className="space-y-4 rounded-2xl border bg-card p-5">
          <h2 className="font-semibold">Payment</h2>
          <div className="flex items-center gap-3 rounded-xl border-2 border-brand bg-brand/5 p-4">
            <Banknote className="size-6 text-brand" />
            <div>
              <div className="font-medium">{type === "DELIVERY" ? "Cash on delivery" : "Pay when you collect"}</div>
              <div className="text-sm text-muted-foreground">Card and online payments at the counter.</div>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="co-note">Note for the restaurant (optional)</Label>
            <Input id="co-note" className="h-11" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. extra spicy, ring the bell" />
          </div>
        </section>
      </div>

      <aside className="h-fit space-y-4 rounded-2xl border bg-card p-5 md:sticky md:top-24">
        <h2 className="font-semibold">Order summary</h2>
        <ul className="space-y-2 text-sm">
          {cart.lines.map((l) => (
            <li key={l.key} className="flex justify-between gap-3">
              <span>
                {l.quantity}× {l.name}
                {l.variantName && ` (${l.variantName})`}
              </span>
              <span className="tabular">{formatMoney(lineUnit(l).times(l.quantity))}</span>
            </li>
          ))}
        </ul>
        <div className="space-y-2 border-t pt-3">
          {coupon ? (
            <div className="flex items-center justify-between rounded-lg bg-success/10 px-3 py-2 text-sm">
              <span>
                Coupon <b className="font-mono">{coupon}</b>
              </span>
              <button
                type="button"
                className="text-xs text-muted-foreground underline"
                onClick={() => {
                  setCoupon("");
                  setCouponInput("");
                }}
              >
                Remove
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input aria-label="Coupon code" placeholder="Coupon code" className="h-10 font-mono uppercase placeholder:font-sans placeholder:normal-case" value={couponInput} onChange={(e) => setCouponInput(e.target.value.toUpperCase())} />
              <Button type="button" variant="outline" className="h-10" disabled={!couponInput.trim() || checkingCoupon} onClick={() => void applyCoupon()} data-testid="apply-coupon">
                {checkingCoupon && <Loader2 className="animate-spin" />}
                Apply
              </Button>
            </div>
          )}
          {couponError && (
            <p className="text-xs text-destructive" data-testid="coupon-error">
              {couponError}
            </p>
          )}
          {pointsAvailable && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={usePoints} onChange={(e) => setPointsToUse(e.target.checked ? (loyalty?.balance ?? 0) : 0)} data-testid="use-points" />
              Use my points ({loyalty?.balance ?? pointsToUse} available)
            </label>
          )}
        </div>
        <dl className="space-y-1 border-t pt-3 text-sm">
          {quote.data ? (
            <>
              <Row k="Subtotal" v={quote.data.subtotal} />
              {money(quote.data.discount).greaterThan(0) && (
                <Row k={[coupon && quote.data.coupon && !quote.data.coupon.freeDelivery ? `Coupon ${coupon}` : null, loyalty?.used ? `${loyalty.used} points` : null].filter(Boolean).join(" + ") || "Discount"} v={`-${quote.data.discount}`} />
              )}
              {money(quote.data.tax).greaterThan(0) && <Row k={`Tax (${quote.data.taxRate}%)`} v={quote.data.tax} />}
              {type === "DELIVERY" && <Row k={quote.data.coupon?.freeDelivery ? "Delivery (free with coupon)" : "Delivery"} v={quote.data.deliveryCharge} />}
              <div className="flex justify-between pt-2 text-lg font-semibold">
                <dt>Total</dt>
                <dd className="tabular" data-testid="checkout-total">{formatMoney(quote.data.grandTotal)}</dd>
              </div>
            </>
          ) : quote.isError ? (
            <div className="space-y-2">
              <p className="text-destructive">{(quote.error as Error).message}</p>
              {(coupon || usePoints) && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setCoupon("");
                    setPointsToUse(0);
                  }}
                >
                  Remove the offer
                </Button>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">Calculating…</p>
          )}
        </dl>
        {belowMinimum && <p className="text-sm text-destructive">Minimum order for delivery here is {formatMoney(quote.data!.minimumOrder)}.</p>}
        <Button
          className="h-12 w-full rounded-full bg-brand text-base text-brand-foreground hover:bg-brand/90"
          disabled={pending || !quote.data || !!belowMinimum || (status.data && !status.data.accepting)}
          onClick={place}
          data-testid="place-order"
        >
          {pending && <Loader2 className="animate-spin" />}
          Place order {quote.data && `· ${formatMoney(quote.data.grandTotal)}`}
        </Button>
        {loyalty?.enabled && loyalty.toEarn > 0 && (
          <p className="text-center text-xs text-muted-foreground">{me ? `You will earn about ${loyalty.toEarn} points.` : `Create an account to earn about ${loyalty.toEarn} points on this order.`}</p>
        )}
        <p className="text-center text-xs text-muted-foreground">We may call to confirm your order.</p>
      </aside>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <dt>{k}</dt>
      <dd className="tabular">{formatMoney(v)}</dd>
    </div>
  );
}
