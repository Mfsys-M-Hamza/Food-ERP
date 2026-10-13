import Link from "next/link";
import type { Metadata } from "next";
import { requireStaffPage } from "@/server/core/page-guard";
import { can } from "@/server/core/rbac";
import { listAuditLogs, listAuditModules, auditFilterSchema } from "@/server/modules/audit/service";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import { AuditDetails } from "./audit-details";

export const metadata: Metadata = { title: "Audit log" };

function pick(v: string | string[] | undefined) {
  return typeof v === "string" && v.length ? v : undefined;
}

export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  const ctx = await requireStaffPage("/admin/audit");
  if (!can(ctx, "audit.view")) return <AccessDenied />;
  const sp = await searchParams;
  const parsed = auditFilterSchema.safeParse({
    module: pick(sp.module),
    q: pick(sp.q),
    from: pick(sp.from),
    to: pick(sp.to),
    cursor: pick(sp.cursor),
  });
  const filters = parsed.success ? parsed.data : { limit: 50 };
  const [{ rows, nextCursor }, modules] = await Promise.all([listAuditLogs(ctx, filters), listAuditModules(ctx)]);

  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ module: pick(sp.module), q: pick(sp.q), from: pick(sp.from), to: pick(sp.to), ...extra })) {
      if (v) p.set(k, v);
    }
    return `?${p.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Audit log"
        description="A permanent record of sensitive changes: who did what, when, and the values before and after. Entries cannot be edited or deleted."
      />
      <Card className="gap-0 py-0">
        <form className="grid gap-2 border-b p-3 sm:grid-cols-2 lg:grid-cols-[1fr_180px_160px_160px_auto]" role="search">
          <Input name="q" defaultValue={pick(sp.q)} placeholder="Search action, record or reason" aria-label="Search" />
          <select
            name="module"
            defaultValue={pick(sp.module) ?? ""}
            aria-label="Module"
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="">All modules</option>
            {modules.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <Input type="date" name="from" defaultValue={pick(sp.from)} aria-label="From date" />
          <Input type="date" name="to" defaultValue={pick(sp.to)} aria-label="To date" />
          <div className="flex gap-2">
            <Button type="submit" variant="secondary">
              Filter
            </Button>
            <Button asChild variant="ghost">
              <Link href="/admin/audit">Reset</Link>
            </Button>
          </div>
        </form>

        {rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">No audit entries match these filters.</p>
        ) : (
          <ul className="divide-y" data-testid="audit-list">
            {rows.map((r) => (
              <li key={r.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Badge variant="secondary" className="font-mono text-[11px]">
                    {r.action}
                  </Badge>
                  <span className="text-sm font-medium">{r.user?.name ?? "System"}</span>
                  {r.entityType && (
                    <span className="text-xs text-muted-foreground">
                      {r.entityType}
                      {r.entityId ? ` · ${r.entityId.length > 14 ? r.entityId.slice(0, 8) + "…" : r.entityId}` : ""}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground tabular">{formatDateTime(r.createdAt)}</span>
                </div>
                {r.reason && <p className="mt-1 text-sm text-muted-foreground">{r.reason}</p>}
                <AuditDetails before={r.before} after={r.after} ip={r.ip} userAgent={r.userAgent} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      {nextCursor && (
        <div className="mt-4 flex justify-center">
          <Button asChild variant="outline">
            <Link href={qs({ cursor: nextCursor })}>Older entries</Link>
          </Button>
        </div>
      )}
    </>
  );
}
