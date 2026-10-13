import Link from "next/link";
import type { Metadata } from "next";
import { Search } from "lucide-react";
import { requireStaffPage } from "@/server/core/page-guard";
import { can } from "@/server/core/rbac";
import { listCustomers } from "@/server/modules/customers/service";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { Pagination } from "@/components/shared/pagination";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/money";
import { timeAgo } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { NewCustomerButton } from "./new-customer";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: PageProps<"/admin/customers">) {
  const ctx = await requireStaffPage("/admin/customers");
  if (!can(ctx, "customers.view")) return <AccessDenied />;
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const sort = (["recent", "spend", "orders", "name"].includes(String(sp.sort)) ? sp.sort : "recent") as "recent";
  const page = Number(sp.page ?? 1) || 1;
  const { rows, total, pageSize } = await listCustomers(ctx, { q, sort, page });

  return (
    <>
      <PageHeader
        title="Customers"
        description="Everyone who ordered by phone, at the counter with a number, or online."
        actions={can(ctx, "customers.manage") ? <NewCustomerButton /> : undefined}
      />
      <Card className="gap-0 py-0">
        <form className="flex flex-wrap gap-2 border-b p-3" role="search">
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input name="q" defaultValue={q} placeholder="Name, phone or e-mail" className="pl-8" aria-label="Search customers" />
          </div>
          <select name="sort" defaultValue={sort} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" aria-label="Sort">
            <option value="recent">Recent orders</option>
            <option value="spend">Top spenders</option>
            <option value="orders">Most orders</option>
            <option value="name">Name</option>
          </select>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead className="text-right">Orders</TableHead>
              <TableHead className="text-right">Spent</TableHead>
              <TableHead className="hidden md:table-cell">Last order</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-12 text-center text-muted-foreground">
                  No customers found.
                </TableCell>
              </TableRow>
            )}
            {rows.map((c) => (
              <TableRow key={c.id} className="relative">
                <TableCell>
                  <Link href={`/admin/customers/${c.id}`} className="font-medium after:absolute after:inset-0">
                    {c.name}
                  </Link>
                  {c.isBlocked && <Badge variant="destructive" className="ml-2">Blocked</Badge>}
                  <div className="text-xs text-muted-foreground">{formatPhone(c.phone) || c.email || "—"}</div>
                </TableCell>
                <TableCell className="text-right tabular">{c.totalOrders}</TableCell>
                <TableCell className="text-right tabular">{formatMoney(c.totalSpent)}</TableCell>
                <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{c.lastOrderAt ? timeAgo(c.lastOrderAt) : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={total} basePath="/admin/customers" params={{ q, sort }} />
      </Card>
    </>
  );
}
