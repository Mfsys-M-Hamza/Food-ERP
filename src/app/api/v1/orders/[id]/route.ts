import { z } from "zod";
import { apiHandler } from "@/server/core/api";
import { getOrder } from "@/server/modules/orders/service";

export const GET = apiHandler<{ id: string }>(async (_req, ctx, params) => getOrder(ctx, z.uuid().parse(params.id)));
