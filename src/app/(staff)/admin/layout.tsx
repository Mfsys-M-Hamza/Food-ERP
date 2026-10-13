import { cookies } from "next/headers";
import { AdminShell } from "@/components/shared/admin-shell";
import { requireStaffPage } from "@/server/core/page-guard";
import { publicContext } from "@/server/core/context";
import { getSetting } from "@/server/modules/settings/service";

// Every admin screen depends on the signed-in user; navigations may block on the server.
export const instant = false;

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const ctx = await requireStaffPage("/admin");
  const [profile, cookieStore] = await Promise.all([getSetting("business.profile"), cookies()]);
  const pub = publicContext(ctx);
  return (
    <AdminShell
      user={{ name: pub.user.name, email: pub.user.email, roles: pub.roles, permissions: pub.permissions, isOwner: pub.isOwner }}
      businessName={profile.name}
      defaultOpen={cookieStore.get("sidebar_state")?.value !== "false"}
    >
      {children}
    </AdminShell>
  );
}
