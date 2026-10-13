"use client";

import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { useShopCart, cartSubtotal } from "./cart-store";
import { useHydrated } from "@/hooks/use-hydrated";
import { formatMoney } from "@/lib/money";

export function CartButton() {
  const lines = useShopCart((s) => s.lines);
  const hydrated = useHydrated();
  const count = hydrated ? lines.reduce((s, l) => s + l.quantity, 0) : 0;
  return (
    <Link
      href="/cart"
      className="relative inline-flex h-10 items-center gap-2 rounded-full bg-foreground px-4 text-sm font-medium text-background transition hover:opacity-90"
      aria-label={`Cart, ${count} items`}
      data-testid="cart-link"
    >
      <ShoppingBag className="size-4" />
      <span className="hidden sm:inline">Cart</span>
      {count > 0 && <span className="rounded-full bg-brand px-1.5 text-xs text-brand-foreground tabular">{count}</span>}
    </Link>
  );
}

/** Sticky bottom bar on phones when the cart has items. */
export function MobileCartBar() {
  const lines = useShopCart((s) => s.lines);
  const hydrated = useHydrated();
  if (!hydrated || lines.length === 0) return null;
  const count = lines.reduce((s, l) => s + l.quantity, 0);
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
      <Link
        href="/cart"
        className="flex h-14 items-center justify-between rounded-2xl bg-brand px-5 font-semibold text-brand-foreground shadow-xl shadow-brand/30"
        data-testid="mobile-cart-bar"
      >
        <span className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-full bg-black/15 text-sm tabular">{count}</span>
          View cart
        </span>
        <span className="tabular">{formatMoney(cartSubtotal(lines))}</span>
      </Link>
    </div>
  );
}
