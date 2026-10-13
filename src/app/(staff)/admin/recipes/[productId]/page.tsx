import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { requireStaffPage } from "@/server/core/page-guard";
import { can } from "@/server/core/rbac";
import { isAppError } from "@/server/core/errors";
import { getRecipeEditor } from "@/server/modules/inventory/recipes";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { RecipeEditor } from "@/features/inventory/recipe-editor";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Recipe" };

export default async function RecipePage({ params }: PageProps<"/admin/recipes/[productId]">) {
  const { productId } = await params;
  if (!z.uuid().safeParse(productId).success) notFound();
  const ctx = await requireStaffPage(`/admin/recipes/${productId}`);
  if (!can(ctx, "recipes.manage")) return <AccessDenied />;
  const data = await getRecipeEditor(ctx, productId).catch((e) => {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  return (
    <div className="max-w-4xl">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link href="/admin/recipes">
          <ArrowLeft /> Recipes
        </Link>
      </Button>
      <PageHeader title={`${data.product.name} recipe`} description="Quantities are per one item, in the ingredient's stock unit (grams, millilitres or pieces)." />
      {data.ingredients.length === 0 ? (
        <p className="text-muted-foreground">
          Add ingredients first under{" "}
          <Link className="underline" href="/admin/inventory/new">
            Ingredients & stock
          </Link>
          .
        </p>
      ) : (
        <RecipeEditor data={data} />
      )}
    </div>
  );
}
