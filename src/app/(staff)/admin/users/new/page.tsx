import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { requireStaffPage } from "@/server/core/page-guard";
import { can } from "@/server/core/rbac";
import { listRoles } from "@/server/modules/rbac/service";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { Button } from "@/components/ui/button";
import { StaffForm } from "../staff-form";

export const metadata: Metadata = { title: "Add staff member" };

export default async function NewUserPage() {
  const ctx = await requireStaffPage("/admin/users/new");
  if (!can(ctx, "users.manage")) return <AccessDenied />;
  const roles = await listRoles(ctx);
  return (
    <div className="max-w-3xl">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link href="/admin/users">
          <ArrowLeft /> Users
        </Link>
      </Button>
      <PageHeader title="Add staff member" />
      <StaffForm
        mode="create"
        roles={roles.map((r) => ({ key: r.key, name: r.name, description: r.description }))}
        canGrantOwner={ctx.isOwner}
      />
    </div>
  );
}
