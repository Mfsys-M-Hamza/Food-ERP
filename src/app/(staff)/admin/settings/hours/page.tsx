import type { Metadata } from "next";
import { requireStaffPage } from "@/server/core/page-guard";
import { can } from "@/server/core/rbac";
import { getBusinessHours } from "@/server/modules/settings/service";
import { AccessDenied } from "@/components/shared/access-denied";
import { HoursForm } from "./hours-form";

export const metadata: Metadata = { title: "Opening hours" };

export default async function HoursPage() {
  const ctx = await requireStaffPage("/admin/settings/hours");
  if (!can(ctx, "settings.view")) return <AccessDenied />;
  const hours = await getBusinessHours(ctx.branchId);
  return <HoursForm initial={hours} canEdit={can(ctx, "settings.manage")} />;
}
