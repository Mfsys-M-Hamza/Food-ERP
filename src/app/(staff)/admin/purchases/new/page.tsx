import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { requireStaffPage } from "@/server/core/page-guard";
import { can } from "@/server/core/rbac";
import { listSuppliers } from "@/server/modules/purchasing/service";
import { ingredientOptions } from "@/server/modules/inventory/service";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { PurchaseEditor } from "@/features/purchasing/purchase-editor";
import { Button } from "@/components/ui/button";
import { businessDate } from "@/lib/business-date";

export const metadata: Metadata = { title: "New purchase" };

function todayInKarachi() {
  return businessDate(new Date(), "Asia/Karachi", 0);
}

export default async function NewPurchasePage({ searchParams }: PageProps<"/admin/purchases/new">) {
  const ctx = await requireStaffPage("/admin/purchases/new");
  if (!can(ctx, "purchases.manage")) return <AccessDenied />;
  const sp = await searchParams;
  const [suppliers, ingredients] = await Promise.all([listSuppliers(ctx), ingredientOptions(ctx)]);
  const today = todayInKarachi();
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link href="/admin/purchases">
          <ArrowLeft /> Purchases
        </Link>
      </Button>
      <PageHeader title="New purchase" />
      <PurchaseEditor
        initial={{
          supplierId: typeof sp.supplier === "string" ? sp.supplier : "",
          supplierInvoiceNo: "",
          invoiceDate: today,
          dueDate: "",
          discount: "0",
          tax: "0",
          notes: "",
          items: [{ ingredientId: "", quantity: "", unit: "", unitCost: "" }],
        }}
        suppliers={suppliers.filter((s) => s.isActive).map((s) => ({ id: s.id, name: s.name }))}
        ingredients={ingredients}
        editable
        canReceive
      />
    </>
  );
}
