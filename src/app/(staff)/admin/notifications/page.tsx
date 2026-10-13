import Link from "next/link";
import type { Metadata } from "next";
import { requireStaffPage } from "@/server/core/page-guard";
import { can } from "@/server/core/rbac";
import { myNotifications } from "@/server/modules/notifications/service";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { MarkAllRead } from "@/features/notifications/mark-all-read";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const ctx = await requireStaffPage("/admin/notifications");
  if (!can(ctx, "notifications.view")) return <AccessDenied />;
  const data = await myNotifications(ctx, { limit: 200 });
  return (
    <>
      <PageHeader
        title="Notifications"
        description="Alerts for you: online orders, low stock, cash differences, overdue invoices and more."
        actions={data.unread > 0 && <MarkAllRead />}
      />
      <Card className="gap-0 py-0">
        <ul className="divide-y">
          {data.items.length === 0 && <li className="p-10 text-center text-sm text-muted-foreground">No notifications yet.</li>}
          {data.items.map((n) => {
            const body = (
              <>
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "bg-muted" : n.severity === "CRITICAL" ? "bg-destructive" : n.severity === "WARNING" ? "bg-warning" : "bg-brand")} />
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-sm", !n.read && "font-medium")}>{n.title}</span>
                  {n.body && <span className="block text-sm text-muted-foreground">{n.body}</span>}
                  <span className="text-xs text-muted-foreground">{formatDateTime(n.createdAt)}</span>
                </span>
                {n.severity === "CRITICAL" && <Badge variant="destructive">Urgent</Badge>}
              </>
            );
            return (
              <li key={n.id}>
                {n.link ? (
                  <Link href={n.link} className="flex gap-3 px-4 py-3 hover:bg-muted/50">
                    {body}
                  </Link>
                ) : (
                  <div className="flex gap-3 px-4 py-3">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}
