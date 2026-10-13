import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { requireStaffPage } from "@/server/core/page-guard";
import { can } from "@/server/core/rbac";
import { listSuppliers } from "@/server/modules/purchasing/service";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { IngredientForm } from "@/features/inventory/ingredient-form";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "New ingredient" };

export default async function NewIngredientPage() {
  const ctx = await requireStaffPage("/admin/inventory/new");
  if (!can(ctx, "inventory.manage")) return <AccessDenied />;
  const suppliers = await listSuppliers(ctx);
  return (
    <div className="max-w-3xl">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link href="/admin/inventory">
          <ArrowLeft /> Ingredients
        </Link>
      </Button>
      <PageHeader title="New ingredient" />
      <IngredientForm suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))} />
    </div>
  );
}
