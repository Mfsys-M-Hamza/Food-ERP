import { z } from "zod";
import { apiHandler } from "@/server/core/api";
import { authorize } from "@/server/core/rbac";
import { getOpenShift, computeShiftSummary } from "@/server/modules/shifts/service";

/** Open shift summary for a till: ?terminalId= */
export const GET = apiHandler(async (req, ctx) => {
  authorize(ctx, "pos.use");
  const terminalId = z.uuid().parse(new URL(req.url).searchParams.get("terminalId"));
  const shift = await getOpenShift(terminalId);
  return shift ? computeShiftSummary(shift.id) : null;
});
