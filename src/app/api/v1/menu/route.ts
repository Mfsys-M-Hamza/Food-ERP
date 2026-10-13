import { apiHandler } from "@/server/core/api";
import { getPublicCatalog } from "@/server/modules/storefront/store";

/** Public online menu (cached). */
export const GET = apiHandler(async () => getPublicCatalog(), { auth: false });
