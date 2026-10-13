import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { requireStaffPage } from "@/server/core/page-guard";
import { can } from "@/server/core/rbac";
import { isAppError } from "@/server/core/errors";
import { getStockCount } from "@/server/modules/inventory/service";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { CountSheet } from "@/features/inventory/count-sheet";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Stock count" };

export default async function CountPage({ params }: PageProps<"/admin/inventory/counts/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await requireStaffPage(`/admin/inventory/counts/${id}`);
  if (!can(ctx, "inventory.manage")) return <AccessDenied />;
  const c = await getStockCount(ctx, id).catch((e) => {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link href="/admin/inventory/counts">
          <ArrowLeft /> Stock counts
        </Link>
      </Button>
      <PageHeader
        title={`Count ${c.countNumber}`}
        description={c.status === "POSTED" ? `Posted ${formatDateTime(c.postedAt)}` : "Enter what you count. Leave blank anything you did not count."}
      />
      <CountSheet key={c.status} id={c.id} posted={c.status === "POSTED"} items={c.items} />
    </>
  );
}
