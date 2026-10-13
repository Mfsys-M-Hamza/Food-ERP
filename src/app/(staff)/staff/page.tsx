import { redirect } from "next/navigation";
import { requireStaffPage, staffHome } from "@/server/core/page-guard";

export const instant = false;

/** Post-login landing: send each person to the screen their role uses. */
export default async function StaffLanding() {
  const ctx = await requireStaffPage();
  redirect(staffHome(ctx));
}
