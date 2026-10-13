/**
 * Permission catalog — the single source of truth for permission keys.
 * Seeded into the `permissions` table; default grants seed the system roles.
 * Pure data: safe to import from client and server.
 *
 * Scope rules (own shift, assigned deliveries) are enforced in services in
 * addition to these keys.
 */

export const ROLE_KEYS = ["owner", "manager", "cashier", "kitchen", "rider"] as const;
export type SystemRoleKey = (typeof ROLE_KEYS)[number];

type Def = {
  module: string;
  description: string;
  /** System roles that get this permission by default. Owner always gets everything. */
  roles: SystemRoleKey[];
};

const M = "manager" as const;
const C = "cashier" as const;
const K = "kitchen" as const;
const R = "rider" as const;

export const PERMISSIONS = {
  // Dashboard
  "dashboard.view": { module: "dashboard", description: "View the executive dashboard", roles: [M] },

  // POS & orders
  "pos.use": { module: "pos", description: "Use the POS screen", roles: [M, C] },
  "orders.view": { module: "orders", description: "View orders", roles: [M, C] },
  "orders.view_all": { module: "orders", description: "View all orders across dates and shifts", roles: [M] },
  "orders.create": { module: "orders", description: "Create orders (POS, phone, admin)", roles: [M, C] },
  "orders.accept": { module: "orders", description: "Accept or reject online orders", roles: [M, C] },
  "orders.discount": { module: "orders", description: "Apply discounts up to the cashier limit", roles: [M, C] },
  "orders.discount.override": { module: "orders", description: "Apply discounts above the cashier limit", roles: [M] },
  "orders.edit_after_kitchen": { module: "orders", description: "Edit an order already sent to the kitchen", roles: [M] },
  "orders.cancel": { module: "orders", description: "Cancel orders", roles: [M] },
  "orders.refund": { module: "orders", description: "Refund orders", roles: [M] },
  "orders.reprint": { module: "orders", description: "Reprint receipts", roles: [M, C] },

  // Kitchen
  "kitchen.view": { module: "kitchen", description: "View the kitchen display", roles: [M, C, K] },
  "kitchen.update": { module: "kitchen", description: "Change preparation status", roles: [M, K] },

  // Delivery
  "delivery.assign": { module: "delivery", description: "Assign riders to deliveries", roles: [M, C] },
  "delivery.manage": { module: "delivery", description: "Manage delivery zones and charges", roles: [M] },
  "delivery.rider": { module: "delivery", description: "See and update own assigned deliveries", roles: [R] },
  "delivery.settle": { module: "delivery", description: "Settle rider cash-on-delivery into a shift", roles: [M, C] },

  // Cash shifts
  "shifts.own": { module: "shifts", description: "Open, operate and close own cash shift", roles: [M, C] },
  "shifts.view_all": { module: "shifts", description: "View all cash shifts", roles: [M] },
  "shifts.approve": { module: "shifts", description: "Approve shift closing discrepancies", roles: [M] },

  // Customers
  "customers.view": { module: "customers", description: "View and search customers", roles: [M, C] },
  "customers.manage": { module: "customers", description: "Create and edit customers", roles: [M, C] },
  "customers.delete": { module: "customers", description: "Delete or block customers", roles: [M] },
  "customers.export": { module: "customers", description: "Export customer data", roles: [] },

  // Menu
  "menu.view": { module: "menu", description: "View menu management", roles: [M] },
  "menu.manage": { module: "menu", description: "Create and edit categories, products, add-ons", roles: [M] },
  "menu.price.change": { module: "menu", description: "Change prices", roles: [M] },
  "menu.availability": { module: "menu", description: "Mark products out of stock / available", roles: [M, C, K] },

  // Inventory, recipes, wastage
  "inventory.view": { module: "inventory", description: "View stock levels", roles: [M, C, K] },
  "inventory.manage": { module: "inventory", description: "Manage ingredients, adjustments and stock counts", roles: [M] },
  "recipes.manage": { module: "recipes", description: "Manage recipes", roles: [M] },
  "wastage.record": { module: "wastage", description: "Record wastage", roles: [M, C, K] },

  // Suppliers & purchases
  "suppliers.manage": { module: "suppliers", description: "Manage suppliers", roles: [M] },
  "purchases.manage": { module: "purchases", description: "Create and receive purchases", roles: [M] },
  "purchases.pay": { module: "purchases", description: "Record supplier payments", roles: [M] },

  // Expenses
  "expenses.create": { module: "expenses", description: "Record expenses (cashier: cash from own shift)", roles: [M, C] },
  "expenses.manage": { module: "expenses", description: "Edit and void expenses, view all", roles: [M] },

  // People
  "employees.manage": { module: "employees", description: "Manage employee profiles", roles: [M] },
  "employees.sensitive": { module: "employees", description: "View national ID and salary fields", roles: [M] },
  "attendance.manage": { module: "attendance", description: "Record attendance for others", roles: [M] },
  "attendance.self": { module: "attendance", description: "Own check-in / check-out", roles: [M, C, K, R] },
  "payroll.prepare": { module: "payroll", description: "Prepare draft payroll", roles: [M] },
  "payroll.approve": { module: "payroll", description: "Approve payroll and mark paid", roles: [] },

  // Marketing
  "coupons.manage": { module: "marketing", description: "Manage coupons", roles: [M] },
  "loyalty.manage": { module: "marketing", description: "Configure loyalty", roles: [M] },

  // Reports
  "reports.operational": { module: "reports", description: "Sales, stock and wastage reports", roles: [M] },
  "reports.financial": { module: "reports", description: "Profit and payroll reports", roles: [] },

  // Notifications
  "notifications.view": { module: "notifications", description: "Receive internal notifications", roles: [M, C, K] },

  // Administration
  "settings.view": { module: "settings", description: "View business settings", roles: [M] },
  "settings.manage": { module: "settings", description: "Change business settings", roles: [] },
  "users.manage": { module: "users", description: "Manage user accounts", roles: [] },
  "roles.manage": { module: "users", description: "Manage roles and permissions", roles: [] },
  "audit.view": { module: "audit", description: "View the audit log", roles: [] },
} as const satisfies Record<string, Def>;

export type PermissionKey = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

export const SYSTEM_ROLES: Record<SystemRoleKey, { name: string; description: string }> = {
  owner: { name: "Owner", description: "Complete system access" },
  manager: { name: "Manager", description: "Runs daily operations, stock, purchases, staff and reports" },
  cashier: { name: "Cashier", description: "POS, customers, orders and own cash shift" },
  kitchen: { name: "Kitchen Staff", description: "Kitchen display only" },
  rider: { name: "Rider", description: "Assigned deliveries only" },
};

/** Default permissions for a system role (owner = all). */
export function defaultPermissionsFor(role: SystemRoleKey): PermissionKey[] {
  if (role === "owner") return [...PERMISSION_KEYS];
  return PERMISSION_KEYS.filter((k) => (PERMISSIONS[k].roles as readonly SystemRoleKey[]).includes(role));
}

export function isPermissionKey(value: string): value is PermissionKey {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}

/** Permissions grouped by module, for the role editor UI. */
export function permissionsByModule(): { module: string; keys: PermissionKey[] }[] {
  const map = new Map<string, PermissionKey[]>();
  for (const key of PERMISSION_KEYS) {
    const m = PERMISSIONS[key].module;
    map.set(m, [...(map.get(m) ?? []), key]);
  }
  return [...map.entries()].map(([module, keys]) => ({ module, keys }));
}
