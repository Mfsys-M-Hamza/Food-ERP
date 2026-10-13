import Link from "next/link";
import type { Metadata } from "next";
import { Plus, Search, Star } from "lucide-react";
import { requireStaffPage } from "@/server/core/page-guard";
import { can, canAny } from "@/server/core/rbac";
import { listCategories, listProducts, type ProductFilter } from "@/server/modules/menu/service";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { ProductThumb } from "@/components/shared/product-thumb";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { AvailabilitySwitch } from "./availability-switch";

export const metadata: Metadata = { title: "Products" };

const STATUSES = [
  { value: "all", label: "All" },
  { value: "active", label: "On sale" },
  { value: "out", label: "Out of stock" },
  { value: "hidden", label: "Hidden" },
] as const;

export default async function ProductsPage({ searchParams }: PageProps<"/admin/menu/products">) {
  const ctx = await requireStaffPage("/admin/menu/products");
  if (!canAny(ctx, ["menu.view", "menu.manage", "menu.availability"])) return <AccessDenied />;
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const categoryId = typeof sp.category === "string" ? sp.category : "";
  const status = (STATUSES.find((s) => s.value === sp.status)?.value ?? "all") as ProductFilter["status"];

  const [products, categories] = await Promise.all([
    listProducts(ctx, { q, categoryId: categoryId || undefined, status }),
    listCategories(ctx),
  ]);
  const canManage = can(ctx, "menu.manage");
  const canToggle = can(ctx, "menu.availability");
  const link = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ ...(q ? { q } : {}), ...(categoryId ? { category: categoryId } : {}), status: status ?? "all", ...patch });
    return `/admin/menu/products?${p}`;
  };

  return (
    <>
      <PageHeader
        title="Products"
        description="Everything you sell. Switch an item off to mark it out of stock without deleting it."
        actions={
          canManage && (
            <Button asChild>
              <Link href="/admin/menu/products/new">
                <Plus /> New product
              </Link>
            </Button>
          )
        }
      />
      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-3 border-b p-3 lg:flex-row lg:items-center">
          <form className="flex flex-1 gap-2" role="search">
            <input type="hidden" name="status" value={status} />
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input name="q" defaultValue={q} placeholder="Search name or SKU" className="pl-8" aria-label="Search products" />
            </div>
            <select
              name="category"
              defaultValue={categoryId}
              aria-label="Category"
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <Button type="submit" variant="secondary">
              Apply
            </Button>
          </form>
          <nav className="flex gap-1 overflow-x-auto" aria-label="Status filter">
            {STATUSES.map((s) => (
              <Link
                key={s.value}
                href={link({ status: s.value })}
                className={cn(
                  "shrink-0 rounded-md px-3 py-1.5 text-sm",
                  status === s.value ? "bg-accent font-medium" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {s.label}
              </Link>
            ))}
          </nav>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead className="hidden md:table-cell">Category</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="hidden lg:table-cell">Shown on</TableHead>
              <TableHead className="w-28 text-center">In stock</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                  No products found.
                </TableCell>
              </TableRow>
            )}
            {products.map((p) => (
              <TableRow key={p.id} className={!p.isActive ? "opacity-60" : undefined}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <ProductThumb name={p.name} imageUrl={p.imageUrl} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 font-medium">
                        <span className="truncate">{p.name}</span>
                        {p.isFeatured && <Star className="size-3.5 fill-warning text-warning" aria-label="Featured" />}
                        {p.type === "DEAL" && <Badge variant="secondary">Deal</Badge>}
                        {!p.isActive && <Badge variant="outline">Hidden</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {p.sku}
                        {p.variantCount > 0 && ` · ${p.variantCount} sizes`}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden text-sm md:table-cell">{p.categoryName}</TableCell>
                <TableCell className="text-right text-sm tabular">
                  {p.minPrice === p.maxPrice ? formatMoney(p.minPrice) : `${formatMoney(p.minPrice)} – ${formatMoney(p.maxPrice, { symbol: "" }).trim()}`}
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  <div className="flex gap-1">
                    {p.showOnPos && <Badge variant="outline">POS</Badge>}
                    {p.showOnline && <Badge variant="outline">Online</Badge>}
                  </div>
                </TableCell>
                <TableCell className="text-center">
                  <AvailabilitySwitch productId={p.id} name={p.name} available={p.isAvailable} disabled={!canToggle} />
                </TableCell>
                <TableCell>
                  {canManage && (
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/admin/menu/products/${p.id}`}>Edit</Link>
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
