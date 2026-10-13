import Link from "next/link";
import type { Metadata } from "next";
import {
  CheckCircle2,
  Circle,
  ArrowRight,
  Store,
  Receipt,
  Clock,
  Users,
  Percent,
  TrendingUp,
  TrendingDown,
  ChefHat,
  Bike,
  BellRing,
  PackageX,
  Wallet,
  Truck,
  HandCoins,
  CalendarCheck,
} from "lucide-react";
import { requireStaffPage } from "@/server/core/page-guard";
import { can, canAny } from "@/server/core/rbac";
import { db } from "@/server/core/db";
import { getSetting } from "@/server/modules/settings/service";
import { dashboardData } from "@/server/modules/reports/dashboard";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const ctx = await requireStaffPage("/admin");
  if (!can(ctx, "dashboard.view")) return <AccessDenied />;

  const [data, profile, finance, staffCount, hoursCount, financeRow] = await Promise.all([
    dashboardData(ctx),
    getSetting("business.profile"),
    getSetting("finance"),
    db.user.count({ where: { kind: "STAFF", status: "ACTIVE" } }),
    db.businessHour.count({ where: { branchId: ctx.branchId } }),
    db.setting.findFirst({ where: { key: "finance", branchId: null }, select: { updatedBy: true } }),
  ]);
  const k = data.kpi;
  const a = data.attention;
  const reports = canAny(ctx, ["reports.operational", "reports.financial"]);
  const max = Math.max(1, ...data.days.map((d) => Number(d.net)));

  const checklist = [
    { icon: Store, title: "Complete the business profile", detail: "Name, address, phone and logo appear on receipts and the website.", done: !!(profile.address && profile.phone && profile.logoUrl), href: "/admin/settings/business" },
    { icon: Percent, title: "Review tax and charges", detail: finance.taxEnabled ? `Tax is on (${finance.taxRateCash}% cash).` : "Tax is currently off.", done: !!financeRow?.updatedBy, href: "/admin/settings/finance" },
    { icon: Clock, title: "Set opening hours", detail: "Used for online ordering and the website.", done: hoursCount === 7, href: "/admin/settings/hours" },
    { icon: Receipt, title: "Customise the receipt", detail: "Header, footer and paper width for your thermal printer.", done: false, href: "/admin/settings/receipt" },
    { icon: Users, title: "Add your staff", detail: `${staffCount} active staff account${staffCount === 1 ? "" : "s"}.`, done: staffCount > 1, href: "/admin/users" },
  ];
  const doneCount = checklist.filter((c) => c.done).length;
  const showSettingsLinks = can(ctx, "settings.manage");

  const tiles = [
    {
      label: "Sales today",
      value: formatMoney(k.net),
      hint:
        k.orders === 0
          ? "No sales yet today"
          : k.changeVsLastWeek === null
            ? "No sales on this day last week"
            : `${k.changeVsLastWeek >= 0 ? "+" : ""}${k.changeVsLastWeek}% vs same day last week`,
      trend: k.orders === 0 ? null : k.changeVsLastWeek,
      href: "/admin/reports/sales",
      testId: "kpi-sales",
    },
    { label: "Orders today", value: String(k.orders), hint: `${k.online} online`, href: "/admin/orders", testId: "kpi-orders" },
    { label: "Average order", value: formatMoney(k.average), hint: k.foodCostPct !== null ? `Food cost ${k.foodCostPct}%` : "—", href: "/admin/reports/products" },
    { label: "Expenses today", value: formatMoney(k.expenses), hint: `Discounts ${formatMoney(k.discounts)}`, href: "/admin/expenses" },
  ];

  const attention = [
    { icon: BellRing, show: data.live.waiting > 0, tone: "destructive", text: `${data.live.waiting} online order${data.live.waiting === 1 ? "" : "s"} waiting to be accepted`, href: "/pos" },
    { icon: PackageX, show: a.lowStock > 0, tone: "warning", text: `${a.lowStock} ingredient${a.lowStock === 1 ? "" : "s"} low on stock${a.outOfStock ? ` (${a.outOfStock} out)` : ""}`, href: "/admin/reports/low-stock" },
    { icon: Truck, show: a.overdueInvoices > 0, tone: "warning", text: `${a.overdueInvoices} supplier invoice${a.overdueInvoices === 1 ? "" : "s"} overdue`, href: "/admin/purchases?payment=UNPAID" },
    { icon: Wallet, show: a.shiftsToReview > 0, tone: "warning", text: `${a.shiftsToReview} closed shift${a.shiftsToReview === 1 ? "" : "s"} with a cash difference to review`, href: "/admin/cash-shifts" },
    { icon: HandCoins, show: a.payrollPending > 0, tone: "default", text: `${a.payrollPending} payroll run${a.payrollPending === 1 ? "" : "s"} to approve or pay`, href: "/admin/payroll" },
  ].filter((x) => x.show);

  return (
    <>
      <PageHeader
        title={`Welcome, ${ctx.user.name.split(" ")[0]}`}
        description={`${formatDate(data.today)} · business day`}
        actions={
          reports && (
            <Button asChild variant="outline">
              <Link href="/admin/reports">All reports</Link>
            </Button>
          )
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className="rounded-xl border bg-card p-4 transition hover:border-brand/50" data-testid={t.testId}>
            <div className="text-xs text-muted-foreground">{t.label}</div>
            <div className="mt-1 text-xl font-semibold tabular sm:text-2xl">{t.value}</div>
            <div className={cn("mt-1 flex items-center gap-1 text-xs text-muted-foreground", t.trend != null && (t.trend >= 0 ? "text-success" : "text-destructive"))}>
              {t.trend != null && (t.trend >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />)}
              {t.hint}
            </div>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Last 14 days</CardTitle>
            <CardDescription>Net sales per business day</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex h-48 items-end gap-1.5" role="img" aria-label="Net sales for the last 14 days">
              {data.days.map((d) => (
                <div key={d.date} className="group relative flex h-full flex-1 flex-col justify-end">
                  <div className={cn("rounded-t transition", d.date === data.today ? "bg-brand" : "bg-brand/50 group-hover:bg-brand/80")} style={{ height: `${Math.max(1.5, (Number(d.net) / max) * 100)}%` }} />
                  <div className="pointer-events-none absolute -top-8 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 text-[11px] text-background group-hover:block">
                    {formatDate(d.date)}: {formatMoney(d.net)} · {d.orders} orders
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
              <span>{formatDate(data.days[0]!.date)}</span>
              <span>Today</span>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Right now</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-2 text-center">
              {[
                { icon: BellRing, label: "Waiting", value: data.live.waiting, href: "/pos" },
                { icon: ChefHat, label: "In kitchen", value: data.live.kitchen, href: "/kitchen" },
                { icon: Bike, label: "On the road", value: data.live.delivering, href: "/admin/orders" },
              ].map((x) => (
                <Link key={x.label} href={x.href} className="rounded-lg bg-muted/50 p-3 hover:bg-muted">
                  <x.icon className="mx-auto size-4 text-muted-foreground" />
                  <div className="text-2xl font-semibold tabular">{x.value}</div>
                  <div className="text-xs text-muted-foreground">{x.label}</div>
                </Link>
              ))}
              <div className="col-span-3 grid grid-cols-2 gap-2 text-left text-sm">
                <div className="rounded-lg border p-2">
                  <div className="text-xs text-muted-foreground">Cash in {a.openShifts} open till{a.openShifts === 1 ? "" : "s"}</div>
                  <div className="font-semibold tabular">{formatMoney(a.drawerCash)}</div>
                </div>
                <Link href="/admin/attendance" className="rounded-lg border p-2 hover:bg-muted/50">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <CalendarCheck className="size-3.5" /> Staff in today
                  </div>
                  <div className="font-semibold tabular">
                    {a.staffPresent} / {a.staffTotal}
                  </div>
                </Link>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Needs attention</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {attention.length === 0 && <p className="text-sm text-muted-foreground">Nothing needs attention.</p>}
              {attention.map((x) => (
                <Link key={x.text} href={x.href} className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-muted/60">
                  <x.icon className={cn("size-4", x.tone === "destructive" ? "text-destructive" : x.tone === "warning" ? "text-warning" : "text-muted-foreground")} />
                  <span className="flex-1">{x.text}</span>
                  <ArrowRight className="size-4 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Best sellers this week</CardTitle>
          </CardHeader>
          <CardContent>
            {data.top.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sales yet this week.</p>
            ) : (
              <ol className="space-y-2">
                {data.top.map((p, i) => (
                  <li key={p.name} className="flex items-center gap-3 text-sm">
                    <span className="grid size-6 place-items-center rounded-full bg-muted text-xs font-medium">{i + 1}</span>
                    <span className="flex-1">{p.name}</span>
                    <span className="tabular text-muted-foreground">{p.qty} sold</span>
                    <span className="w-24 text-right tabular">{formatMoney(p.revenue)}</span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        {doneCount < checklist.length && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle>Finish setting up</CardTitle>
                  <CardDescription>Remaining steps before going live.</CardDescription>
                </div>
                <Badge variant="secondary" className="tabular">
                  {doneCount}/{checklist.length} done
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-1">
              {checklist
                .filter((c) => !c.done)
                .map((item) => {
                  const Icon = item.icon;
                  const body = (
                    <>
                      <span className="mt-0.5 shrink-0">{item.done ? <CheckCircle2 className="size-5 text-success" /> : <Circle className="size-5 text-muted-foreground/50" />}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 font-medium">
                          <Icon className="size-4 text-muted-foreground" />
                          {item.title}
                        </span>
                        <span className="mt-0.5 block text-sm text-muted-foreground">{item.detail}</span>
                      </span>
                    </>
                  );
                  return showSettingsLinks ? (
                    <Link key={item.title} href={item.href} className="-mx-2 flex gap-3 rounded-lg px-2 py-3 hover:bg-muted/60">
                      {body}
                    </Link>
                  ) : (
                    <div key={item.title} className="-mx-2 flex gap-3 px-2 py-3">
                      {body}
                    </div>
                  );
                })}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
