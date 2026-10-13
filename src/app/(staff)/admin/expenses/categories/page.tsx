import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { requireStaffPage } from "@/server/core/page-guard";
import { can } from "@/server/core/rbac";
import { listExpenseCategories } from "@/server/modules/expenses/service";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { CategoryManager } from "@/features/expenses/category-manager";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Expense categories" };

export default async function ExpenseCategoriesPage() {
  const ctx = await requireStaffPage("/admin/expenses/categories");
  if (!can(ctx, "expenses.manage")) return <AccessDenied />;
  const categories = await listExpenseCategories(ctx, { includeInactive: true, includeSystem: true });
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link href="/admin/expenses">
          <ArrowLeft /> Expenses
        </Link>
      </Button>
      <PageHeader title="Expense categories" description="Archived categories stay on old expenses but cannot be chosen for new ones." />
      <CategoryManager categories={categories} />
    </>
  );
}
