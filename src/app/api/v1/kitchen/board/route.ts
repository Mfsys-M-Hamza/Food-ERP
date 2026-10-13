import { apiHandler } from "@/server/core/api";
import { listBoardNumbers } from "@/server/modules/kitchen/service";

export const GET = apiHandler(async (_req, ctx) => listBoardNumbers(ctx));
