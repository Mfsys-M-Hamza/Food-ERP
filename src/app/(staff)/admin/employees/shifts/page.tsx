import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, Pencil } from "lucide-react";
import { requireStaffPage } from "@/server/core/page-guard";
import { can } from "@/server/core/rbac";
import { listWorkShifts } from "@/server/modules/people/employees";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { WorkShiftDialog } from "@/features/people/work-shifts";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Work shifts" };

export default async function WorkShiftsPage() {
  const ctx = await requireStaffPage("/admin/employees/shifts");
  if (!can(ctx, "employees.manage")) return <AccessDenied />;
  const rows = await listWorkShifts(ctx);
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link href="/admin/employees">
          <ArrowLeft /> Employees
        </Link>
      </Button>
      <PageHeader title="Work shifts" description="Scheduled hours. Check-ins after the grace period count as late; time worked beyond the shift counts as overtime." actions={<WorkShiftDialog />} />
      <Card className="gap-0 py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Shift</TableHead>
              <TableHead>Hours</TableHead>
              <TableHead className="hidden md:table-cell">Grace / break</TableHead>
              <TableHead className="hidden md:table-cell">Staff</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  No shifts yet. Add your opening and closing shifts.
                </TableCell>
              </TableRow>
            )}
            {rows.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">
                  {s.name}
                  {!s.isActive && (
                    <Badge variant="outline" className="ml-2">
                      Inactive
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="tabular">
                  {s.start} – {s.end}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {s.graceMinutes} min / {s.breakMinutes} min
                </TableCell>
                <TableCell className="hidden md:table-cell">{s.employees}</TableCell>
                <TableCell>
                  <WorkShiftDialog
                    id={s.id}
                    initial={{ name: s.name, start: s.start, end: s.end, graceMinutes: s.graceMinutes, breakMinutes: s.breakMinutes, isActive: s.isActive }}
                    trigger={
                      <Button size="icon" variant="ghost" aria-label={`Edit ${s.name}`}>
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
