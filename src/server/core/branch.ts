import "server-only";
import { db } from "./db";

/**
 * The current deployment runs one branch. Multi-branch support later replaces
 * this with a branch chosen from the user's session/terminal.
 */
let cachedDefaultBranchId: string | undefined;

export async function getDefaultBranchId(): Promise<string> {
  if (cachedDefaultBranchId) return cachedDefaultBranchId;
  const branch = await db.branch.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!branch) throw new Error("No active branch found. Run `npm run db:seed` first.");
  cachedDefaultBranchId = branch.id;
  return branch.id;
}

/** Test helper: forget the cached branch (database was re-seeded). */
export function __resetBranchCache() {
  cachedDefaultBranchId = undefined;
}
