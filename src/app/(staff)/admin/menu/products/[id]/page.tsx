import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { requireStaffPage } from "@/server/core/page-guard";
import { can } from "@/server/core/rbac";
import { isAppError } from "@/server/core/errors";
import { getProductForEditor, listAddonGroups, listCategories } from "@/server/modules/menu/service";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { Button } from "@/components/ui/button";
import { ProductEditor } from "../product-editor";

export const metadata: Metadata = { title: "Edit product" };

export default async function EditProductPage({ params }: PageProps<"/admin/menu/products/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await requireStaffPage(`/admin/menu/products/${id}`);
  if (!can(ctx, "menu.manage")) return <AccessDenied />;

  const product = await getProductForEditor(ctx, id).catch((e) => {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const [categories, groups] = await Promise.all([listCategories(ctx), listAddonGroups(ctx)]);

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link href="/admin/menu/products">
          <ArrowLeft /> Products
        </Link>
      </Button>
      <PageHeader title={product.name} description={`SKU ${product.sku}`} />
      <ProductEditor
        product={product}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        groups={groups.filter((g) => g.isActive || product.addonGroupIds.includes(g.id))}
        canChangePrice={can(ctx, "menu.price.change")}
      />
    </>
  );
}
