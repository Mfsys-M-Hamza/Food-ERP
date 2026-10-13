import "server-only";
import { db, type Db } from "./db";
import { businessDate } from "@/lib/business-date";
import { getSetting } from "@/server/modules/settings/service";

/** Today's business date ("2026-10-12") for the branch, honouring the day cut-off. */
export async function todayFor(branchId: string, client: Db = db, now = new Date()): Promise<string> {
  const branch = await client.branch.findUniqueOrThrow({ where: { id: branchId }, select: { timezone: true } });
  const ordering = await getSetting("ordering", client);
  return businessDate(now, branch.timezone, ordering.dayCutoffHour);
}

/** "2026-10-12" → Date at UTC midnight, the form Prisma uses for DATE columns. */
export function dayToDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** DATE column value → "2026-10-12". */
export function dateToDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
