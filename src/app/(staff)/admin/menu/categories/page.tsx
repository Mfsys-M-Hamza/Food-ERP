import type { Metadata } from "next";
import { requireStaffPage } from "@/server/core/page-guard";
import { can, canAny } from "@/server/core/rbac";
import { listCategories } from "@/server/modules/menu/service";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { CategoryManager } from "./category-manager";

export const metadata: Metadata = { title: "Categories" };

export default async function CategoriesPage() {
  const ctx = await requireStaffPage("/admin/menu/categories");
  if (!canAny(ctx, ["menu.view", "menu.manage"])) return <AccessDenied />;
  const categories = await listCategories(ctx);
  return (
    <div className="max-w-3xl">
      <PageHeader title="Categories" description="Groups shown as tabs on the POS and the website, in this order." />
      <CategoryManager key={JSON.stringify(categories)} categories={categories} canManage={can(ctx, "menu.manage")} />
    </div>
  );
}
