import { expect, test } from "@playwright/test";
import { signInAs } from "./accounts";

const PAGES = [
  "/admin",
  "/admin/settings/business",
  "/admin/settings/hours",
  "/admin/settings/finance",
  "/admin/settings/ordering",
  "/admin/settings/receipt",
  "/admin/users",
  "/admin/users/new",
  "/admin/roles",
  "/admin/audit",
  "/admin/menu/products",
  "/admin/menu/products/new",
  "/admin/menu/categories",
  "/admin/menu/addon-groups",
  "/admin/orders",
  "/admin/cash-shifts",
  "/admin/customers",
  "/admin/delivery-zones",
  "/admin/inventory",
  "/admin/inventory/new",
  "/admin/inventory/counts",
  "/admin/recipes",
  "/admin/wastage",
  "/admin/suppliers",
  "/admin/purchases",
  "/admin/purchases/new",
  "/admin/expenses",
  "/admin/expenses/categories",
  "/admin/employees",
  "/admin/employees/new",
  "/admin/employees/shifts",
  "/admin/attendance",
  "/admin/attendance?view=month",
  "/admin/payroll",
  "/admin/clock",
  "/admin/settings/payroll",
  "/admin/reports",
  "/admin/reports/sales",
  "/admin/reports/products",
  "/admin/reports/profit",
  "/admin/reports/inventory",
  "/admin/reports/attendance",
  "/admin/coupons",
  "/admin/deliveries",
  "/admin/notifications",
  "/admin/settings/notifications",
  "/admin/settings/loyalty",
  "/pos",
  "/kitchen",
  "/display",
  "/rider",
  "/",
  "/menu",
  "/cart",
  "/checkout",
  "/contact",
  "/account/login",
];

test("no console errors or page exceptions on Phase 1 screens", async ({ page }) => {
  test.setTimeout(180_000);
  const problems: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(`${page.url()} console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => problems.push(`${page.url()} exception: ${err.message}`));

  await page.goto("/staff/login");
  await signInAs(page, "owner");
  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  }
  // Client-side navigation through the sidebar as well.
  await page.goto("/admin");
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/admin\/settings\/business/);
  await page.getByRole("link", { name: "Users" }).click();
  await expect(page).toHaveURL(/\/admin\/users$/);

  expect(problems).toEqual([]);
});
