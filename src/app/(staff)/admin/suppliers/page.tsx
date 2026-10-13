import Link from "next/link";
import type { Metadata } from "next";
import { requireStaffPage } from "@/server/core/page-guard";
import { can } from "@/server/core/rbac";
import { listSuppliers } from "@/server/modules/purchasing/service";
import { listIngredients } from "@/server/modules/inventory/service";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { SupplierDialog } from "@/features/purchasing/supplier-form";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, money } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

export const metadata: Metadata = { title: "Suppliers" };

export default async function SuppliersPage() {
  const ctx = await requireStaffPage("/admin/suppliers");
  if (!can(ctx, "suppliers.manage")) return <AccessDenied />;
  const [rows, ingredients] = await Promise.all([listSuppliers(ctx), listIngredients(ctx, {})]);
  const owed = rows.reduce((s, r) => s.plus(r.outstanding), money(0));
  return (
    <>
      <PageHeader
        title="Suppliers"
        description={`Who you buy from and what you owe. Total outstanding: ${formatMoney(owed)}.`}
        actions={<SupplierDialog ingredients={ingredients.map((i) => ({ id: i.id, name: i.name }))} />}
      />
      <Card className="gap-0 py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Supplier</TableHead>
              <TableHead className="hidden md:table-cell">Last purchase</TableHead>
              <TableHead className="hidden text-right lg:table-cell">Purchased</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                  No suppliers yet.
                </TableCell>
              </TableRow>
            )}
            {rows.map((s) => (
              <TableRow key={s.id} className="relative">
                <TableCell>
                  <Link href={`/admin/suppliers/${s.id}`} className="font-medium after:absolute after:inset-0">
                    {s.name}
                  </Link>
                  {!s.isActive && <Badge variant="outline" className="ml-2">Inactive</Badge>}
                  <div className="text-xs text-muted-foreground">{[s.contactPerson, formatPhone(s.phone)].filter(Boolean).join(" · ") || "—"}</div>
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{s.lastPurchaseAt ? formatDate(s.lastPurchaseAt) : "—"}</TableCell>
                <TableCell className="hidden text-right tabular lg:table-cell">{formatMoney(s.purchasesTotal)}</TableCell>
                <TableCell className={`text-right font-medium tabular ${money(s.outstanding).greaterThan(0) ? "text-destructive" : ""}`}>{formatMoney(s.outstanding)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
