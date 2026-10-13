import type { Metadata } from "next";
import { CartView } from "@/features/storefront/cart-view";

export const metadata: Metadata = { title: "Cart" };

export default function CartPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <CartView />
    </main>
  );
}
