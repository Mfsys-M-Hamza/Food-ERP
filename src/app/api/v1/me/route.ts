import { apiHandler } from "@/server/core/api";
import { getCustomerSession, listMyAddresses, listMyFavorites } from "@/server/modules/storefront/account";

/** Signed-in customer's checkout details, or null for visitors (not an error). */
export const GET = apiHandler(
  async () => {
    const s = await getCustomerSession();
    if (!s) return null;
    const [addresses, favorites] = await Promise.all([listMyAddresses(s), listMyFavorites(s)]);
    return { name: s.customer.name, phone: s.customer.phone, email: s.customer.email, addresses, favorites };
  },
  { auth: false },
);
