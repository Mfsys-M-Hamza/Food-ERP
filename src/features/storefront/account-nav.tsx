"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { LogOut, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { reorderLinesAction } from "@/server/modules/storefront/actions";
import { apiGet } from "@/lib/api-client";
import type { Catalog } from "@/server/modules/menu/catalog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useShopCart } from "./cart-store";

const TABS = [
  { href: "/account", label: "Profile" },
  { href: "/account/orders", label: "Orders" },
  { href: "/account/addresses", label: "Addresses" },
];

export function AccountNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 border-b" aria-label="Account">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cn("-mb-px border-b-2 px-4 py-2 text-sm font-medium", pathname === t.href ? "border-brand text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function AccountSignOut() {
  const router = useRouter();
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        await authClient.signOut();
        router.replace("/");
        router.refresh();
      }}
    >
      <LogOut /> Sign out
    </Button>
  );
}

/** Puts the items of a past order back into the cart (skipping anything no longer sold). */
export function ReorderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const add = useShopCart((s) => s.add);
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      data-testid={`reorder-${orderId}`}
      onClick={() =>
        start(async () => {
          const [r, menu] = await Promise.all([reorderLinesAction(orderId), apiGet<Catalog>("/api/v1/menu")]);
          if (!r.ok) return void toast.error(r.error);
          let skipped = 0;
          for (const l of r.data) {
            const p = menu.products.find((x) => x.id === l.productId && x.isAvailable);
            const v = l.variantId ? p?.variants.find((x) => x.id === l.variantId && x.isAvailable) : null;
            const addons = p?.addonGroups.flatMap((g) => g.addons).filter((a) => l.addonIds.includes(a.id) && a.isAvailable) ?? [];
            if (!p || (l.variantId && !v) || addons.length !== l.addonIds.length) {
              skipped++;
              continue;
            }
            add({
              productId: p.id,
              variantId: v?.id ?? null,
              name: p.name,
              variantName: v?.name ?? null,
              unitPrice: v?.price ?? p.price,
              addons: addons.map((a) => ({ id: a.id, name: a.name, price: a.price })),
              removables: p.removables.filter((x) => l.removableIds.includes(x.id)),
              quantity: l.quantity,
              note: l.note,
            });
          }
          if (skipped) toast(`${skipped} item(s) are no longer available and were skipped.`);
          router.push("/cart");
        })
      }
    >
      <RotateCcw /> Order again
    </Button>
  );
}
