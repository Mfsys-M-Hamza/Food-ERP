import { apiHandler } from "@/server/core/api";
import { getStoreStatus } from "@/server/modules/storefront/store";

export const GET = apiHandler(async () => getStoreStatus(), { auth: false });
