import { apiHandler } from "@/server/core/api";
import { getPosBootstrap } from "@/server/modules/pos/bootstrap";

export const GET = apiHandler(async (_req, ctx) => getPosBootstrap(ctx));
