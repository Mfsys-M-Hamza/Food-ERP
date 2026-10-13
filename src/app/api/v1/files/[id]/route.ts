import { z } from "zod";
import { connection } from "next/server";
import { getContextFromHeaders } from "@/server/core/context";
import { apiError } from "@/server/core/api";
import { AppError } from "@/server/core/errors";
import { readPrivateDocument } from "@/server/core/storage";
import { canReadReceipt } from "@/server/modules/expenses/service";

/** Private documents (expense receipts). Served only to staff allowed to see the expense. */
export async function GET(req: Request, route: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { id } = await route.params;
    if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND", "File not found.");
    const ctx = await getContextFromHeaders(req.headers);
    if (!ctx) throw new AppError("UNAUTHENTICATED", "Please sign in.");
    if (!(await canReadReceipt(ctx, id))) throw new AppError("NOT_FOUND", "File not found.");
    const file = await readPrivateDocument(id);
    if (!file) throw new AppError("NOT_FOUND", "File not found.");
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": "inline",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
