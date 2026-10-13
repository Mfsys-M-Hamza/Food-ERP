import { Suspense } from "react";
import type { Metadata } from "next";
import { getPublicCatalog } from "@/server/modules/storefront/store";
import { StoreClosedBanner } from "@/features/storefront/store-status";
import { MenuBrowser } from "@/features/storefront/menu-browser";

export const metadata: Metadata = { title: "Menu" };

export default async function MenuPage() {
  const catalog = await getPublicCatalog();
  return (
    <main>
      <Suspense>
        <StoreClosedBanner />
      </Suspense>
      <Suspense>
        <MenuBrowser catalog={catalog} />
      </Suspense>
    </main>
  );
}
