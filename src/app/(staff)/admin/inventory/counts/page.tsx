import Link from "next/link";
import type { Metadata } from "next";
import { requireStaffPage } from "@/server/core/page-guard";
import { can } from "@/server/core/rbac";
import { listStockCounts } from "@/server/modules/inventory/service";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import { StartCountButton } from "@/features/inventory/count-sheet";

export const metadata: Metadata = { title: "Stock counts" };

export default async function CountsPage() {
  const ctx = await requireStaffPage("/admin/inventory/counts");
  if (!can(ctx, "inventory.manage")) return <AccessDenied />;
  const counts = await listStockCounts(ctx);
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Stock counts"
        description="Count what is really on the shelves. Posting a count corrects stock and records the difference as a variance."
        actions={<StartCountButton />}
      />
      <Card className="gap-0 divide-y py-0">
        {counts.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">No counts yet. Weekly counts keep recipe-based stock accurate.</p>}
        {counts.map((c) => (
          <Link key={c.id} href={`/admin/inventory/counts/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50">
            <span className="font-medium">{c.countNumber}</span>
            <Badge variant={c.status === "DRAFT" ? "default" : "outline"}>{c.status === "DRAFT" ? "In progress" : "Posted"}</Badge>
            <span className="text-sm text-muted-foreground">{c.note}</span>
            <span className="ml-auto text-sm text-muted-foreground">{formatDateTime(c.postedAt ?? c.createdAt)}</span>
          </Link>
        ))}
      </Card>
    </div>
  );
}
