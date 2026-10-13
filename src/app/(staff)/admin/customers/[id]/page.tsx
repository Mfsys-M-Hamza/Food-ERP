import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, MapPin, Star } from "lucide-react";
import { z } from "zod";
import { requireStaffPage } from "@/server/core/page-guard";
import { can } from "@/server/core/rbac";
import { isAppError } from "@/server/core/errors";
import { getCustomer } from "@/server/modules/customers/service";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { StatusBadge } from "@/features/orders/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatPhone, whatsappDigits } from "@/lib/phone";
import type { OrderStatus } from "@/server/modules/orders/state-machine";
import { CustomerEditor } from "./customer-editor";
import { customerLoyalty } from "@/server/modules/marketing/loyalty";
import { LoyaltyCard } from "@/features/marketing/loyalty-card";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerPage({ params }: PageProps<"/admin/customers/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await requireStaffPage(`/admin/customers/${id}`);
  if (!can(ctx, "customers.view")) return <AccessDenied />;
  const c = await getCustomer(ctx, id).catch((e) => {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const avg = c.totalOrders ? Number(c.totalSpent) / c.totalOrders : 0;
  const loyalty = await customerLoyalty(ctx, id);

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link href="/admin/customers">
          <ArrowLeft /> Customers
        </Link>
      </Button>
      <PageHeader
        title={c.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {formatPhone(c.phone) || "No phone"} · customer since {formatDate(c.createdAt)}
            {c.isBlocked && <Badge variant="destructive">Blocked{c.blockReason ? `: ${c.blockReason}` : ""}</Badge>}
          </span>
        }
        actions={
          c.phone ? (
            <Button asChild variant="outline">
              <a href={`https://wa.me/${whatsappDigits(c.phone)}`} target="_blank" rel="noopener noreferrer">
                WhatsApp
              </a>
            </Button>
          ) : undefined
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        {[
          ["Orders", String(c.totalOrders)],
          ["Total spent", formatMoney(c.totalSpent)],
          ["Average order", formatMoney(avg.toFixed(2))],
          ["Last order", c.lastOrderAt ? formatDate(c.lastOrderAt) : "—"],
        ].map(([k, v]) => (
          <Card key={k} className="gap-1 py-4">
            <CardContent>
              <div className="text-xs text-muted-foreground">{k}</div>
              <div className="text-xl font-semibold tabular">{v}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card className="gap-0 py-0">
          <CardHeader className="py-4">
            <CardTitle>Order history</CardTitle>
          </CardHeader>
          <ul className="divide-y border-t text-sm">
            {c.orders.length === 0 && <li className="p-6 text-center text-muted-foreground">No orders yet.</li>}
            {c.orders.map((o) => (
              <li key={o.id}>
                <Link href={`/admin/orders/${o.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-muted/50">
                  <span>
                    <span className="font-medium">{o.orderNumber}</span>
                    <span className="block text-xs text-muted-foreground">
                      {formatDateTime(o.createdAt)} · {o.type.toLowerCase().replace("_", "-")} · {o.source}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <StatusBadge status={o.status as OrderStatus} />
                    <span className="tabular">{formatMoney(o.grandTotal)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <div className="space-y-6">
          {(loyalty.enabled || loyalty.balance > 0) && (
            <LoyaltyCard customerId={id} balance={loyalty.balance} value={loyalty.value} history={loyalty.history} canAdjust={can(ctx, "loyalty.manage") && loyalty.enabled} />
          )}
          {c.favourites.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Favourite items</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {c.favourites.map((f) => (
                    <li key={f.name} className="flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <Star className="size-3.5 text-warning" /> {f.name}
                      </span>
                      <span className="tabular text-muted-foreground">× {f.quantity}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Addresses</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {c.addresses.length === 0 && <p className="text-muted-foreground">No saved addresses.</p>}
              {c.addresses.map((a) => (
                <div key={a.id} className="flex gap-2">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-brand" />
                  <span>
                    <span className="font-medium">{a.label}</span>
                    {a.isDefault && <Badge variant="secondary" className="ml-2">Default</Badge>}
                    <span className="block text-muted-foreground">
                      {a.addressLine}
                      {a.landmark ? ` · near ${a.landmark}` : ""}
                    </span>
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
          {can(ctx, "customers.manage") && (
            <CustomerEditor
              customer={{
                id: c.id,
                name: c.name,
                phone: c.phone ?? "",
                email: c.email ?? "",
                notes: c.notes ?? "",
                marketingOptIn: c.marketingOptIn,
                isBlocked: c.isBlocked,
                blockReason: c.blockReason ?? "",
              }}
              canBlock={can(ctx, "customers.delete")}
            />
          )}
        </div>
      </div>
    </>
  );
}
