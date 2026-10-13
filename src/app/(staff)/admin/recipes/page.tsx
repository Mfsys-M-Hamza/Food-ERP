import Link from "next/link";
import type { Metadata } from "next";
import { requireStaffPage } from "@/server/core/page-guard";
import { can } from "@/server/core/rbac";
import { listRecipeOverview } from "@/server/modules/inventory/recipes";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Recipes" };

export default async function RecipesPage() {
  const ctx = await requireStaffPage("/admin/recipes");
  if (!can(ctx, "recipes.manage")) return <AccessDenied />;
  const rows = await listRecipeOverview(ctx);
  const missing = rows.filter((r) => !r.hasRecipe && r.variantsWithRecipe === 0).length;
  return (
    <>
      <PageHeader
        title="Recipes"
        description={`What goes into each item. Recipes drive automatic stock deduction and food cost. ${missing ? `${missing} item(s) have no recipe yet.` : "Every item has a recipe."}`}
      />
      <Card className="gap-0 py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="hidden md:table-cell">Recipe</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Food cost</TableHead>
              <TableHead className="text-right">Cost %</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.productId} className="relative">
                <TableCell>
                  <Link href={`/admin/recipes/${r.productId}`} className="font-medium after:absolute after:inset-0">
                    {r.name}
                  </Link>
                  <div className="text-xs text-muted-foreground">{r.category}</div>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {r.hasRecipe || r.variantsWithRecipe ? (
                    <Badge variant="secondary">
                      {r.hasRecipe ? "Base recipe" : ""}
                      {r.variantCount > 0 && ` · ${r.variantsWithRecipe}/${r.variantCount} sizes`}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-warning text-warning-foreground">
                      Missing
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right tabular">{formatMoney(r.price)}</TableCell>
                <TableCell className="text-right tabular">{formatMoney(r.cost)}</TableCell>
                <TableCell className={cn("text-right font-medium tabular", r.foodCostPercent !== null && r.foodCostPercent > 40 && "text-destructive")}>
                  {r.foodCostPercent === null ? "—" : `${r.foodCostPercent}%`}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
