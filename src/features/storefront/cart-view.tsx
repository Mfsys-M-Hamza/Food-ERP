"use client";

import Link from "next/link";
import { Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/hooks/use-hydrated";
import { formatMoney } from "@/lib/money";
import { useShopCart, lineUnit, cartSubtotal } from "./cart-store";

export function CartView() {
  const hydrated = useHydrated();
  const { lines, setQuantity } = useShopCart();
  if (!hydrated) return <div className="h-64" />;

  if (lines.length === 0) {
    return (
      <div className="flex flex-col items-center py-20 text-center">
        <ShoppingBag className="size-12 text-muted-foreground/50" />
        <h1 className="mt-4 text-2xl font-semibold">Your cart is empty</h1>
        <p className="mt-1 text-muted-foreground">Add something delicious from the menu.</p>
        <Button asChild className="mt-6 h-12 rounded-full px-8">
          <Link href="/menu">See the menu</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-8 md:grid-cols-[1fr_320px]">
      <div>
        <h1 className="mb-4 text-2xl font-semibold tracking-tight">Your cart</h1>
        <ul className="divide-y rounded-2xl border bg-card" data-testid="shop-cart">
          {lines.map((l) => (
            <li key={l.key} className="flex gap-4 p-4">
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {l.name}
                  {l.variantName && <span className="text-muted-foreground"> · {l.variantName}</span>}
                </div>
                {(l.addons.length > 0 || l.removables.length > 0 || l.note) && (
                  <div className="text-sm text-muted-foreground">
                    {[...l.addons.map((a) => `+ ${a.name}`), ...l.removables.map((r) => r.label), l.note && `“${l.note}”`].filter(Boolean).join(" · ")}
                  </div>
                )}
                <div className="mt-2 flex items-center gap-1">
                  <Button variant="outline" size="icon" className="size-9 rounded-full" onClick={() => setQuantity(l.key, l.quantity - 1)} aria-label={`Fewer ${l.name}`}>
                    {l.quantity === 1 ? <Trash2 /> : <Minus />}
                  </Button>
                  <span className="w-8 text-center font-semibold tabular">{l.quantity}</span>
                  <Button variant="outline" size="icon" className="size-9 rounded-full" onClick={() => setQuantity(l.key, l.quantity + 1)} aria-label={`More ${l.name}`}>
                    <Plus />
                  </Button>
                </div>
              </div>
              <div className="font-medium tabular">{formatMoney(lineUnit(l).times(l.quantity))}</div>
            </li>
          ))}
        </ul>
        <Link href="/menu" className="mt-4 inline-block text-sm font-medium text-brand">
          + Add more items
        </Link>
      </div>
      <aside className="h-fit space-y-4 rounded-2xl border bg-card p-5 md:sticky md:top-24">
        <div className="flex justify-between text-lg font-semibold">
          <span>Subtotal</span>
          <span className="tabular" data-testid="shop-subtotal">{formatMoney(cartSubtotal(lines))}</span>
        </div>
        <p className="text-sm text-muted-foreground">Delivery charge and any tax are added at checkout.</p>
        <Button asChild className="h-12 w-full rounded-full bg-brand text-base text-brand-foreground hover:bg-brand/90">
          <Link href="/checkout" data-testid="go-checkout">
            Checkout
          </Link>
        </Button>
      </aside>
    </div>
  );
}
