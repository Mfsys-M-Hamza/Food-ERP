import type { PermissionKey } from "@/lib/rbac/catalog";

/**
 * Admin navigation. Items are shown only when the user holds one of the
 * listed permissions (the server enforces access again on every page).
 */
export type NavIcon =
  | "dashboard" | "pos" | "kitchen" | "orders" | "deliveries" | "shifts" | "customers"
  | "menu" | "categories" | "addons"
  | "ingredients" | "recipes" | "stock" | "wastage" | "suppliers" | "purchases"
  | "expenses" | "employees" | "attendance" | "payroll" | "clock"
  | "coupons" | "loyalty" | "reports" | "notifications"
  | "settings" | "users" | "roles" | "audit";

export type NavItem = { title: string; href: string; icon: NavIcon; anyOf: PermissionKey[] };
export type NavGroup = { label: string; items: NavItem[] };

export const ADMIN_NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { title: "Dashboard", href: "/admin", icon: "dashboard", anyOf: ["dashboard.view"] },
      { title: "Reports", href: "/admin/reports", icon: "reports", anyOf: ["reports.operational", "reports.financial"] },
      { title: "Notifications", href: "/admin/notifications", icon: "notifications", anyOf: ["notifications.view"] },
    ],
  },
  {
    label: "Operations",
    items: [
      { title: "POS", href: "/pos", icon: "pos", anyOf: ["pos.use"] },
      { title: "Kitchen display", href: "/kitchen", icon: "kitchen", anyOf: ["kitchen.view"] },
      { title: "Orders", href: "/admin/orders", icon: "orders", anyOf: ["orders.view"] },
      { title: "Cash shifts", href: "/admin/cash-shifts", icon: "shifts", anyOf: ["shifts.view_all", "shifts.own"] },
      { title: "Customers", href: "/admin/customers", icon: "customers", anyOf: ["customers.view"] },
      { title: "Deliveries", href: "/admin/deliveries", icon: "deliveries", anyOf: ["delivery.assign", "delivery.manage"] },
      { title: "Delivery areas", href: "/admin/delivery-zones", icon: "deliveries", anyOf: ["delivery.manage"] },
      { title: "Coupons", href: "/admin/coupons", icon: "coupons", anyOf: ["coupons.manage"] },
    ],
  },
  {
    label: "Menu",
    items: [
      { title: "Products", href: "/admin/menu/products", icon: "menu", anyOf: ["menu.view", "menu.manage", "menu.availability"] },
      { title: "Categories", href: "/admin/menu/categories", icon: "categories", anyOf: ["menu.view", "menu.manage"] },
      { title: "Add-on groups", href: "/admin/menu/addon-groups", icon: "addons", anyOf: ["menu.view", "menu.manage"] },
    ],
  },
  {
    label: "Inventory",
    items: [
      { title: "Ingredients & stock", href: "/admin/inventory", icon: "ingredients", anyOf: ["inventory.view", "inventory.manage"] },
      { title: "Recipes", href: "/admin/recipes", icon: "recipes", anyOf: ["recipes.manage"] },
      { title: "Stock counts", href: "/admin/inventory/counts", icon: "stock", anyOf: ["inventory.manage"] },
      { title: "Wastage", href: "/admin/wastage", icon: "wastage", anyOf: ["wastage.record"] },
      { title: "Suppliers", href: "/admin/suppliers", icon: "suppliers", anyOf: ["suppliers.manage"] },
      { title: "Purchases", href: "/admin/purchases", icon: "purchases", anyOf: ["purchases.manage", "purchases.pay"] },
    ],
  },
  {
    label: "Business",
    items: [
      { title: "Expenses", href: "/admin/expenses", icon: "expenses", anyOf: ["expenses.create", "expenses.manage"] },
      { title: "Employees", href: "/admin/employees", icon: "employees", anyOf: ["employees.manage"] },
      { title: "Attendance", href: "/admin/attendance", icon: "attendance", anyOf: ["attendance.manage"] },
      { title: "Payroll", href: "/admin/payroll", icon: "payroll", anyOf: ["payroll.prepare", "payroll.approve"] },
      { title: "My time clock", href: "/admin/clock", icon: "clock", anyOf: ["attendance.self"] },
    ],
  },
  {
    label: "Administration",
    items: [
      { title: "Settings", href: "/admin/settings", icon: "settings", anyOf: ["settings.view"] },
      { title: "Users", href: "/admin/users", icon: "users", anyOf: ["users.manage"] },
      { title: "Roles & permissions", href: "/admin/roles", icon: "roles", anyOf: ["roles.manage"] },
      { title: "Audit log", href: "/admin/audit", icon: "audit", anyOf: ["audit.view"] },
    ],
  },
];

export function visibleNav(permissions: readonly string[], isOwner: boolean): NavGroup[] {
  const has = (p: PermissionKey) => isOwner || permissions.includes(p);
  return ADMIN_NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.anyOf.some(has)) })).filter(
    (g) => g.items.length > 0,
  );
}
