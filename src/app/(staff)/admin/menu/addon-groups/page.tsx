import type { Metadata } from "next";
import { requireStaffPage } from "@/server/core/page-guard";
import { can, canAny } from "@/server/core/rbac";
import { listAddonGroups } from "@/server/modules/menu/service";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { AddonGroupManager } from "./addon-group-manager";

export const metadata: Metadata = { title: "Add-on groups" };

export default async function AddonGroupsPage() {
  const ctx = await requireStaffPage("/admin/menu/addon-groups");
  if (!canAny(ctx, ["menu.view", "menu.manage"])) return <AccessDenied />;
  const groups = await listAddonGroups(ctx);
  return (
    <>
      <PageHeader
        title="Add-on groups"
        description="Extras (extra cheese, sauces) and required choices (pick a drink). Attach groups to products in the product editor."
      />
      <AddonGroupManager groups={groups} canManage={can(ctx, "menu.manage")} canChangePrice={can(ctx, "menu.price.change")} />
    </>
  );
}
