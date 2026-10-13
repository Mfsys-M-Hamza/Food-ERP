import type { Metadata } from "next";
import { requireStaffPage } from "@/server/core/page-guard";
import { can } from "@/server/core/rbac";
import { AccessDenied } from "@/components/shared/access-denied";
import { QueryProvider } from "@/components/shared/query-provider";
import { RiderApp } from "@/features/rider/rider-app";

export const instant = false;
export const metadata: Metadata = { title: "My deliveries" };

export default async function RiderPage() {
  const ctx = await requireStaffPage("/rider");
  if (!can(ctx, "delivery.rider")) return <AccessDenied />;
  return (
    <QueryProvider>
      <RiderApp userName={ctx.user.name} />
    </QueryProvider>
  );
}
