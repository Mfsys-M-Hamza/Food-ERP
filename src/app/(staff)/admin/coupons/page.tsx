import type { Metadata } from "next";
import { Pencil } from "lucide-react";
import { requireStaffPage } from "@/server/core/page-guard";
import { can } from "@/server/core/rbac";
import { listCoupons, getCoupon } from "@/server/modules/marketing/coupons";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { CouponDialog } from "@/features/marketing/coupon-form";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Coupons" };

const STATE: Record<string, "default" | "secondary" | "outline" | "destructive"> = { Live: "default", Scheduled: "secondary", Paused: "outline", Ended: "outline", "Used up": "outline" };

export default async function CouponsPage() {
  const ctx = await requireStaffPage("/admin/coupons");
  if (!can(ctx, "coupons.manage")) return <AccessDenied />;
  const rows = await listCoupons(ctx);
  const forms = await Promise.all(rows.map((r) => getCoupon(ctx, r.id)));
  return (
    <>
      <PageHeader title="Coupons" description="Codes customers enter online or give at the counter. Each use is checked on the server and recorded." actions={<CouponDialog />} />
      <Card className="gap-0 py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Offer</TableHead>
              <TableHead className="hidden md:table-cell">Uses</TableHead>
              <TableHead className="hidden md:table-cell text-right">Discount given</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  No coupons yet.
                </TableCell>
              </TableRow>
            )}
            {rows.map((c, i) => (
              <TableRow key={c.id} data-testid={`coupon-${c.code}`}>
                <TableCell>
                  <div className="font-mono font-medium">{c.code}</div>
                  <Badge variant={STATE[c.state] ?? "outline"} className="mt-1">
                    {c.state}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">
                  {c.type === "PERCENT" ? `${Number(c.value)}% off` : c.type === "AMOUNT" ? `${formatMoney(c.value)} off` : "Free delivery"}
                  {Number(c.minOrder) > 0 && <span className="text-muted-foreground"> · min {formatMoney(c.minOrder)}</span>}
                  <div className="text-xs text-muted-foreground">
                    {c.channel === "ALL" ? "Online and counter" : c.channel === "ONLINE" ? "Online only" : "Counter only"}
                    {c.endsAt && ` · until ${formatDate(c.endsAt)}`}
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell tabular">
                  {c.usedCount}
                  {c.usageLimit !== null && ` / ${c.usageLimit}`}
                </TableCell>
                <TableCell className="hidden md:table-cell text-right tabular">{formatMoney(c.discountGiven)}</TableCell>
                <TableCell>
                  <CouponDialog
                    id={c.id}
                    initial={forms[i]}
                    trigger={
                      <Button size="icon" variant="ghost" aria-label={`Edit ${c.code}`}>
                        <Pencil />
                      </Button>
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
