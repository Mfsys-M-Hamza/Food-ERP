import type { Metadata } from "next";
import { requireStaffPage } from "@/server/core/page-guard";
import { canAny } from "@/server/core/rbac";
import { AccessDenied } from "@/components/shared/access-denied";
import { QueryProvider } from "@/components/shared/query-provider";
import { getSetting } from "@/server/modules/settings/service";
import { ReadyBoard } from "@/features/kitchen/ready-board";

export const instant = false;
export const metadata: Metadata = { title: "Order board" };

/** Customer-facing TV: "Preparing" and "Ready for pickup" numbers. Runs on a staff-signed-in device. */
export default async function DisplayPage() {
  const ctx = await requireStaffPage("/display");
  if (!canAny(ctx, ["kitchen.view", "pos.use"])) return <AccessDenied />;
  const profile = await getSetting("business.profile");
  return (
    <QueryProvider>
      <ReadyBoard businessName={profile.name} />
    </QueryProvider>
  );
}
