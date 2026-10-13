import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { requireStaffPage } from "@/server/core/page-guard";
import { can } from "@/server/core/rbac";
import { isAppError } from "@/server/core/errors";
import { getStaff } from "@/server/modules/users/service";
import { listRoles } from "@/server/modules/rbac/service";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { StaffForm } from "../staff-form";
import { PasswordCard, PinCard } from "./credential-cards";

export const metadata: Metadata = { title: "Edit user" };

export default async function EditUserPage({ params }: PageProps<"/admin/users/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await requireStaffPage(`/admin/users/${id}`);
  if (!can(ctx, "users.manage")) return <AccessDenied />;

  let user;
  try {
    user = await getStaff(ctx, id);
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const roles = await listRoles(ctx);

  return (
    <div className="max-w-3xl">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link href="/admin/users">
          <ArrowLeft /> Users
        </Link>
      </Button>
      <PageHeader
        title={user.name}
        description={`Created ${formatDateTime(user.createdAt)} · Last sign-in ${formatDateTime(user.lastLoginAt)}`}
      />
      <div className="space-y-6">
        <StaffForm
          mode="edit"
          userId={user.id}
          isSelf={user.id === ctx.user.id}
          canGrantOwner={ctx.isOwner}
          roles={roles.map((r) => ({ key: r.key, name: r.name, description: r.description }))}
          initial={{
            name: user.name,
            email: user.email,
            phone: user.phone ?? "",
            roleKeys: user.roles.map((r) => r.key),
            status: user.status,
          }}
        />
        <div className="grid gap-6 md:grid-cols-2">
          <PasswordCard userId={user.id} />
          <PinCard userId={user.id} hasPin={user.hasPin} />
        </div>
      </div>
    </div>
  );
}
