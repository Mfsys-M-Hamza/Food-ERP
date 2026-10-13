import type { Metadata } from "next";
import { requireStaffPage } from "@/server/core/page-guard";
import { can, canAny } from "@/server/core/rbac";
import { AccessDenied } from "@/components/shared/access-denied";
import { QueryProvider } from "@/components/shared/query-provider";
import { KdsApp } from "@/features/kitchen/kds-app";

export const instant = false;
export const metadata: Metadata = { title: "Kitchen" };

export default async function KitchenPage() {
  const ctx = await requireStaffPage("/kitchen");
  if (!canAny(ctx, ["kitchen.view", "kitchen.update"])) return <AccessDenied />;
  return (
    <QueryProvider>
      <KdsApp
        canUpdate={can(ctx, "kitchen.update")}
        canToggleStock={can(ctx, "menu.availability")}
        userName={ctx.user.name}
        showAdmin={can(ctx, "dashboard.view")}
      />
    </QueryProvider>
  );
}
