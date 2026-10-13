import Link from "next/link";
import type { Metadata } from "next";
import { AlertTriangle, Plus, Search } from "lucide-react";
import { requireStaffPage } from "@/server/core/page-guard";
import { can, canAny } from "@/server/core/rbac";
import { listIngredients } from "@/server/modules/inventory/service";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { AdjustStockButton } from "@/features/inventory/adjust-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, money } from "@/lib/money";
import { formatQty } from "@/lib/units";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Ingredients & stock" };

export default async function InventoryPage({ searchParams }: PageProps<"/admin/inventory">) {
  const ctx = await requireStaffPage("/admin/inventory");
  if (!canAny(ctx, ["inventory.view", "inventory.manage"])) return <AccessDenied />;
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const filter = (["low", "all", "inactive"].includes(String(sp.filter)) ? sp.filter : "active") as "low";
  const [rows, all] = await Promise.all([listIngredients(ctx, { q, filter }), listIngredients(ctx, {})]);
  const lowCount = all.filter((r) => r.low).length;
  const value = all.reduce((s, r) => s.plus(r.stockValue), money(0));
  const manage = can(ctx, "inventory.manage");
  const showCost = can(ctx, "inventory.manage") || can(ctx, "reports.operational");

  return (
    <>
      <PageHeader
        title="Ingredients & stock"
        description="Live stock in base units. Sales deduct stock automatically from recipes."
        actions={
          manage && (
            <Button asChild>
              <Link href="/admin/inventory/new">
                <Plus /> New ingredient
              </Link>
            </Button>
          )
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card className="py-4">
          <CardContent>
            <div className="text-xs text-muted-foreground">Ingredients</div>
            <div className="text-2xl font-semibold tabular">{all.length}</div>
          </CardContent>
        </Card>
        <Card className={cn("py-4", lowCount > 0 && "border-warning/60 bg-warning/5")}>
          <CardContent>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {lowCount > 0 && <AlertTriangle className="size-3.5 text-warning" />} Below minimum
            </div>
            <Link href="/admin/inventory?filter=low" className="text-2xl font-semibold tabular underline-offset-4 hover:underline">
              {lowCount}
            </Link>
          </CardContent>
        </Card>
        {showCost && (
          <Card className="py-4">
            <CardContent>
              <div className="text-xs text-muted-foreground">Stock value (average cost)</div>
              <div className="text-2xl font-semibold tabular">{formatMoney(value)}</div>
            </CardContent>
          </Card>
        )}
      </div>
      <Card className="gap-0 py-0">
        <form className="flex flex-wrap items-center gap-2 border-b p-3" role="search">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input name="q" defaultValue={q} placeholder="Search ingredient or category" className="pl-8" aria-label="Search ingredients" />
          </div>
          <select name="filter" defaultValue={filter} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" aria-label="Show">
            <option value="active">Active</option>
            <option value="low">Below minimum</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </select>
          <Button type="submit" variant="secondary">
            Apply
          </Button>
        </form>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ingredient</TableHead>
              <TableHead className="text-right">In stock</TableHead>
              <TableHead className="hidden text-right md:table-cell">Minimum</TableHead>
              {showCost && <TableHead className="hidden text-right lg:table-cell">Avg cost</TableHead>}
              {showCost && <TableHead className="hidden text-right lg:table-cell">Value</TableHead>}
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                  No ingredients.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id} data-testid={`ingredient-${r.name}`}>
                <TableCell>
                  <Link href={`/admin/inventory/${r.id}`} className="font-medium hover:underline">
                    {r.name}
                  </Link>
                  {r.low && (
                    <Badge variant="outline" className="ml-2 border-warning text-warning-foreground">
                      Low
                    </Badge>
                  )}
                  {!r.isActive && <Badge variant="outline" className="ml-2">Inactive</Badge>}
                  <div className="text-xs text-muted-foreground">
                    {[r.category, r.supplierName, r.usedInRecipes ? `${r.usedInRecipes} recipes` : null].filter(Boolean).join(" · ") || "—"}
                  </div>
                </TableCell>
                <TableCell className={cn("text-right font-medium tabular", money(r.onHand).isNegative() && "text-destructive")}>{formatQty(r.onHand, r.baseUnit)}</TableCell>
                <TableCell className="hidden text-right text-muted-foreground tabular md:table-cell">{formatQty(r.minStock, r.baseUnit)}</TableCell>
                {showCost && (
                  <TableCell className="hidden text-right text-sm text-muted-foreground tabular lg:table-cell">
                    {formatMoney(money(r.averageCost).times(r.baseUnit === "piece" ? 1 : 1000).toFixed(2))}/{r.baseUnit === "g" ? "kg" : r.baseUnit === "ml" ? "l" : "pc"}
                  </TableCell>
                )}
                {showCost && <TableCell className="hidden text-right tabular lg:table-cell">{formatMoney(r.stockValue)}</TableCell>}
                <TableCell>{manage && <AdjustStockButton ingredientId={r.id} name={r.name} onHandText={formatQty(r.onHand, r.baseUnit)} />}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
