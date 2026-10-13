import type { Metadata } from "next";
import { requireStaffPage } from "@/server/core/page-guard";
import { can } from "@/server/core/rbac";
import { listZones } from "@/server/modules/delivery/zones";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { ZoneManager } from "./zone-manager";

export const metadata: Metadata = { title: "Delivery areas" };

export default async function ZonesPage() {
  const ctx = await requireStaffPage("/admin/delivery-zones");
  if (!can(ctx, "delivery.manage")) return <AccessDenied />;
  const zones = await listZones(ctx.branchId);
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Delivery areas"
        description="Each area has its own delivery charge, minimum order and delivery time. Orders without an area use the defaults in Settings › Delivery."
      />
      <ZoneManager key={JSON.stringify(zones)} zones={zones} />
    </div>
  );
}
