import type { Metadata } from "next";
import { requireStaffPage } from "@/server/core/page-guard";
import { can } from "@/server/core/rbac";
import { listRoles } from "@/server/modules/rbac/service";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { PERMISSIONS, permissionsByModule } from "@/lib/rbac/catalog";
import { RoleMatrix } from "./role-matrix";
import { NewRoleDialog } from "./new-role-dialog";

export const metadata: Metadata = { title: "Roles & permissions" };

export default async function RolesPage() {
  const ctx = await requireStaffPage("/admin/roles");
  if (!can(ctx, "roles.manage")) return <AccessDenied />;
  const roles = await listRoles(ctx);
  const groups = permissionsByModule().map((g) => ({
    module: g.module,
    permissions: g.keys.map((k) => ({ key: k, description: PERMISSIONS[k].description })),
  }));

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        description="Tick what each role may do. Changes apply on the next page load for everyone with that role. The server enforces these rules on every action."
        actions={<NewRoleDialog />}
      />
      <RoleMatrix key={roles.map((r) => r.id).join(",")} roles={roles} groups={groups} />
    </>
  );
}
