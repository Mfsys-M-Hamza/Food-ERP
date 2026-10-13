import Link from "next/link";
import type { Metadata } from "next";
import { requireStaffPage } from "@/server/core/page-guard";
import { can } from "@/server/core/rbac";
import { listWastage } from "@/server/modules/inventory/wastage";
import { listIngredients } from "@/server/modules/inventory/service";
import { getCatalog } from "@/server/modules/menu/catalog";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { RecordWastageButton } from "@/features/inventory/wastage-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Wastage" };

const LABEL: Record<string, string> = {
  EXPIRED: "Expired",
  BURNED: "Burned",
  DAMAGED: "Damaged",
  SPOILED: "Spoiled",
  WRONG_PREPARATION: "Wrong preparation",
  STAFF_MEAL: "Staff meal",
  CANCELLED_ORDER: "Cancelled order",
  OTHER: "Other",
};

export default async function WastagePage({ searchParams }: PageProps<"/admin/wastage">) {
  const ctx = await requireStaffPage("/admin/wastage");
  if (!can(ctx, "wastage.record")) return <AccessDenied />;
  const sp = await searchParams;
  const pick = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const f = { from: pick(sp.from), to: pick(sp.to), reason: pick(sp.reason) };
  const [data, ingredients, catalog] = await Promise.all([listWastage(ctx, f), listIngredients(ctx, {}), getCatalog("POS")]);

  return (
    <>
      <PageHeader
        title="Wastage"
        description="Expired, burned or spoiled food. Recording it keeps stock accurate and shows where money is lost."
        actions={
          <RecordWastageButton
            ingredients={ingredients.map((i) => ({ id: i.id, name: i.name, baseUnit: i.baseUnit }))}
            products={catalog.products.map((p) => ({ id: p.id, name: p.name, variants: p.variants.map((v) => ({ id: v.id, name: v.name })) }))}
          />
        }
      />
      <div className="mb-6 flex flex-wrap gap-3">
        <Card className="min-w-44 py-4">
          <CardContent>
            <div className="text-xs text-muted-foreground">Estimated cost</div>
            <div className="text-2xl font-semibold tabular" data-testid="wastage-total">{formatMoney(data.totalCost)}</div>
          </CardContent>
        </Card>
        {data.byReason.map((r) => (
          <Card key={r.reason} className="min-w-36 py-4">
            <CardContent>
              <div className="text-xs text-muted-foreground">
                {LABEL[r.reason]} · {r.count}
              </div>
              <div className="text-lg font-semibold tabular">{formatMoney(r.cost)}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="gap-0 py-0">
        <form className="flex flex-wrap items-center gap-2 border-b p-3">
          <Input type="date" name="from" defaultValue={f.from} className="w-auto" aria-label="From" />
          <Input type="date" name="to" defaultValue={f.to} className="w-auto" aria-label="To" />
          <select name="reason" defaultValue={f.reason ?? ""} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" aria-label="Reason">
            <option value="">All reasons</option>
            {Object.entries(LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
          <Button asChild variant="ghost">
            <Link href="/admin/wastage">Reset</Link>
          </Button>
        </form>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead className="hidden md:table-cell">Recorded</TableHead>
              <TableHead className="text-right">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                  No wastage recorded.
                </TableCell>
              </TableRow>
            )}
            {data.rows.map((w) => (
              <TableRow key={w.id}>
                <TableCell>
                  <div className="font-medium">
                    {w.itemName} <span className="font-normal text-muted-foreground">· {Number(w.quantity)} {w.unit}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {w.wastageNumber}
                    {w.notes && ` · ${w.notes}`}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{LABEL[w.reason]}</Badge>
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                  {formatDateTime(w.occurredAt)} · {w.employeeName}
                </TableCell>
                <TableCell className="text-right tabular">{formatMoney(w.estimatedCost)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
