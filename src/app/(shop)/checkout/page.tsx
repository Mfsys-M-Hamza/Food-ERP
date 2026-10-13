import type { Metadata } from "next";
import { getPublicProfile } from "@/server/modules/storefront/store";
import { CheckoutForm } from "@/features/storefront/checkout-form";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default async function CheckoutPage() {
  const { zones, ordering } = await getPublicProfile();
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <CheckoutForm zones={zones} takeawayEnabled={ordering.takeawayEnabled} deliveryEnabled={ordering.deliveryEnabled} />
    </main>
  );
}
