import Link from "next/link";
import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import { requireStaffPage } from "@/server/core/page-guard";
import { can, canAny } from "@/server/core/rbac";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { REPORTS, REPORT_KEYS, type ReportGroup } from "@/lib/reports";

export const metadata: Metadata = { title: "Reports" };

const GROUPS: ReportGroup[] = ["Sales", "Money", "Stock", "People"];

export default async function ReportsPage() {
  const ctx = await requireStaffPage("/admin/reports");
  if (!canAny(ctx, ["reports.operational", "reports.financial"])) return <AccessDenied />;
  const visible = REPORT_KEYS.filter((k) => can(ctx, REPORTS[k].permission));
  return (
    <>
      <PageHeader title="Reports" description="Every report can be filtered by date, exported to Excel or CSV, and printed or saved as PDF." />
      <div className="space-y-8">
        {GROUPS.map((g) => {
          const keys = visible.filter((k) => REPORTS[k].group === g);
          if (!keys.length) return null;
          return (
            <section key={g}>
              <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">{g}</h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {keys.map((k) => (
                  <Link key={k} href={`/admin/reports/${k}`} className="group flex items-center gap-3 rounded-xl border bg-card p-4 transition hover:border-brand/50 hover:bg-muted/40">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{REPORTS[k].title}</span>
                      <span className="mt-0.5 block text-sm text-muted-foreground">{REPORTS[k].description}</span>
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5" />
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
