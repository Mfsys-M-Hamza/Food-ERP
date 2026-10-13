"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { NotificationBell } from "@/features/notifications/bell";
import { useTheme } from "next-themes";
import {
  LayoutDashboard, MonitorSmartphone, ChefHat, Settings, Users, ShieldCheck, ScrollText, LogOut, Moon, Sun,
  ChevronsUpDown, UtensilsCrossed, ReceiptText, Bike, Wallet, Contact, Sandwich, LayoutGrid, ListPlus, Wheat,
  BookOpenCheck, Boxes, Trash2, Truck, PackagePlus, Banknote, IdCard, CalendarCheck, HandCoins, TicketPercent,
  Gift, ChartColumn, Bell, Clock, type LucideIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { authClient } from "@/lib/auth-client";
import { visibleNav, type NavIcon } from "@/lib/nav";

const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard, pos: MonitorSmartphone, kitchen: ChefHat, orders: ReceiptText, deliveries: Bike,
  shifts: Wallet, customers: Contact, menu: Sandwich, categories: LayoutGrid, addons: ListPlus, ingredients: Wheat,
  recipes: BookOpenCheck, stock: Boxes, wastage: Trash2, suppliers: Truck, purchases: PackagePlus, expenses: Banknote,
  employees: IdCard, attendance: CalendarCheck, payroll: HandCoins, clock: Clock, coupons: TicketPercent, loyalty: Gift,
  reports: ChartColumn, notifications: Bell, settings: Settings, users: Users, roles: ShieldCheck, audit: ScrollText,
};

export type ShellUser = { name: string; email: string; roles: string[]; permissions: string[]; isOwner: boolean };

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

function isActive(pathname: string, href: string) {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(href + "/");
}

export function AdminShell({
  user,
  businessName,
  defaultOpen,
  children,
}: {
  user: ShellUser;
  businessName: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const groups = visibleNav(user.permissions, user.isOwner);

  async function signOut() {
    await authClient.signOut();
    router.replace("/staff/login");
    router.refresh();
  }

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild tooltip={businessName}>
                <Link href="/admin">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                    <UtensilsCrossed className="size-4" />
                  </span>
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate font-semibold">{businessName}</span>
                    <span className="truncate text-xs text-muted-foreground">Management</span>
                  </span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          {groups.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => {
                    const Icon = ICONS[item.icon];
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton asChild isActive={isActive(pathname, item.href)} tooltip={item.title}>
                          <Link href={item.href}>
                            <Icon />
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent" data-testid="user-menu">
                    <Avatar className="size-8 rounded-lg">
                      <AvatarFallback className="rounded-lg bg-sidebar-accent text-xs font-medium">
                        {initials(user.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
                      <span className="truncate text-sm font-medium">{user.name}</span>
                      <span className="truncate text-xs capitalize text-muted-foreground">{user.roles.join(", ")}</span>
                    </span>
                    <ChevronsUpDown className="ml-auto size-4" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-60">
                  <DropdownMenuLabel className="font-normal">
                    <div className="text-sm font-medium">{user.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{user.email}</div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
                    {resolvedTheme === "dark" ? <Sun /> : <Moon />}
                    {resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={signOut} data-testid="sign-out">
                    <LogOut />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
          <span className="truncate text-sm text-muted-foreground">{businessName}</span>
          {(user.isOwner || user.permissions.includes("notifications.view")) && (
            <div className="ml-auto">
              <NotificationBell />
            </div>
          )}
        </header>
        <div className="flex-1 p-4 md:p-6 lg:p-8">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
