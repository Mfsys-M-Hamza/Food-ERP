import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { requireStaffPage } from "@/server/core/page-guard";
import { can } from "@/server/core/rbac";
import { linkableUsers, workShiftOptions } from "@/server/modules/people/employees";
import { todayFor } from "@/server/core/today";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { EmployeeForm } from "@/features/people/employee-form";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Add employee" };

export default async function NewEmployeePage() {
  const ctx = await requireStaffPage("/admin/employees/new");
  if (!can(ctx, "employees.manage")) return <AccessDenied />;
  const sensitive = can(ctx, "employees.sensitive");
  const [users, shifts, today] = await Promise.all([linkableUsers(ctx), workShiftOptions(ctx), todayFor(ctx.branchId)]);
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link href="/admin/employees">
          <ArrowLeft /> Employees
        </Link>
      </Button>
      <PageHeader title="Add employee" />
      <EmployeeForm
        sensitive={sensitive}
        users={users}
        shifts={shifts}
        initial={{
          fullName: "",
          phone: "",
          designation: "",
          department: "",
          employmentType: "FULL_TIME",
          status: "ACTIVE",
          joiningDate: today,
          leavingDate: "",
          workShiftId: "",
          weeklyOffDays: [],
          userId: "",
          address: "",
          emergencyName: "",
          emergencyPhone: "",
          notes: "",
          ...(sensitive ? { payType: "MONTHLY" as const, baseRate: "", overtimeRate: "", nationalId: "", bankName: "", bankAccount: "" } : {}),
        }}
      />
    </>
  );
}
