import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { requireStaffPage } from "@/server/core/page-guard";
import { can } from "@/server/core/rbac";
import { listAddonGroups, listCategories } from "@/server/modules/menu/service";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { Button } from "@/components/ui/button";
import { ProductEditor } from "../product-editor";

export const metadata: Metadata = { title: "New product" };

export default async function NewProductPage() {
  const ctx = await requireStaffPage("/admin/menu/products/new");
  if (!can(ctx, "menu.manage") || !can(ctx, "menu.price.change")) return <AccessDenied />;
  const [categories, groups] = await Promise.all([listCategories(ctx), listAddonGroups(ctx)]);

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link href="/admin/menu/products">
          <ArrowLeft /> Products
        </Link>
      </Button>
      <PageHeader title="New product" />
      {categories.length === 0 ? (
        <p className="text-muted-foreground">
          Create a category first under{" "}
          <Link className="underline" href="/admin/menu/categories">
            Menu › Categories
          </Link>
          .
        </p>
      ) : (
        <ProductEditor
          categories={categories.map((c) => ({ id: c.id, name: c.name }))}
          groups={groups.filter((g) => g.isActive)}
          canChangePrice
        />
      )}
    </>
  );
}
