import type { Metadata } from "next";
import { requireCustomer, listMyAddresses } from "@/server/modules/storefront/account";
import { getPublicProfile } from "@/server/modules/storefront/store";
import { AddressBook } from "@/features/storefront/address-book";

export const metadata: Metadata = { title: "My addresses", robots: { index: false } };

export default async function AddressesPage() {
  const [addresses, { zones }] = await Promise.all([requireCustomer().then(listMyAddresses), getPublicProfile()]);
  return <AddressBook key={JSON.stringify(addresses)} addresses={addresses} zones={zones} />;
}
