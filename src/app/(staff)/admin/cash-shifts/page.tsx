import Link from "next/link";
import type { Metadata } from "next";
import { requireStaffPage } from "@/server/core/page-guard";
import { canAny } from "@/server/core/rbac";
import { listShifts } from "@/server/modules/shifts/service";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, money } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Cash shifts" };

export default async function ShiftsPage({ searchParams }: PageProps<"/admin/cash-shifts">) {
  const ctx = await requireStaffPage("/admin/cash-shifts");
  if (!canAny(ctx, ["shifts.view_all", "shifts.own"])) return <AccessDenied />;
  const sp = await searchParams;
  const status = typeof sp.status === "string" ? sp.status : undefined;
  const rows = await listShifts(ctx, { status });
  const tabs = [
    ["", "All"],
    ["OPEN", "Open"],
    ["CLOSED", "Needs approval"],
    ["APPROVED", "Approved"],
  ];

  return (
    <>
      <PageHeader title="Cash shifts" description="Opening cash, sales and the count at closing for every till." />
      <div className="mb-3 flex gap-1">
        {tabs.map(([v, label]) => (
          <Link
            key={v}
            href={v ? `/admin/cash-shifts?status=${v}` : "/admin/cash-shifts"}
            className={cn("rounded-md px-3 py-1.5 text-sm", (status ?? "") === v ? "bg-accent font-medium" : "text-muted-foreground hover:bg-muted")}
          >
            {label}
          </Link>
        ))}
      </div>
      <Card className="gap-0 py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Shift</TableHead>
              <TableHead className="hidden md:table-cell">Opened</TableHead>
              <TableHead className="hidden md:table-cell">Closed</TableHead>
              <TableHead className="text-right">Expected</TableHead>
              <TableHead className="text-right">Counted</TableHead>
              <TableHead className="text-right">Difference</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                  No shifts.
                </TableCell>
              </TableRow>
            )}
            {rows.map((s) => {
              const diff = s.difference ? money(s.difference) : null;
              return (
                <TableRow key={s.id} className="relative">
                  <TableCell>
                    <Link href={`/admin/cash-shifts/${s.id}`} className="font-medium after:absolute after:inset-0">
                      {s.shiftNumber}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {s.terminalName} · {s.openedBy}
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell">{formatDateTime(s.openedAt)}</TableCell>
                  <TableCell className="hidden text-sm md:table-cell">{formatDateTime(s.closedAt)}</TableCell>
                  <TableCell className="text-right tabular">{s.expectedCash ? formatMoney(s.expectedCash) : "—"}</TableCell>
                  <TableCell className="text-right tabular">{s.countedCash ? formatMoney(s.countedCash) : "—"}</TableCell>
                  <TableCell className={cn("text-right tabular", diff && !diff.isZero() && "text-destructive")}>
                    {diff ? (diff.isZero() ? "0" : formatMoney(diff)) : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={s.status === "OPEN" ? "default" : s.status === "CLOSED" ? "secondary" : "outline"}>
                      {s.status === "CLOSED" ? "Needs approval" : s.status === "OPEN" ? "Open" : "Approved"}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
