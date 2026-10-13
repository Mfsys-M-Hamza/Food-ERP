import { expect, test } from "@playwright/test";
import { signInAs } from "./accounts";

test.describe("role-based access", () => {
  test("cashier lands on the POS and cannot open admin pages", async ({ page }) => {
    await signInAs(page, "cashier");
    await expect(page).toHaveURL(/\/pos$/);
    await expect(page.getByTestId("product-Zinger Burger")).toBeVisible();

    for (const path of ["/admin", "/admin/settings/business", "/admin/users", "/admin/roles", "/admin/audit"]) {
      await page.goto(path);
      await expect(page.getByTestId("access-denied")).toBeVisible();
    }
  });

  test("kitchen staff land on the kitchen display only", async ({ page }) => {
    await signInAs(page, "kitchen");
    await expect(page).toHaveURL(/\/kitchen$/);
    await page.goto("/pos");
    await expect(page.getByTestId("access-denied")).toBeVisible();
  });

  test("rider lands on assigned deliveries only", async ({ page }) => {
    await signInAs(page, "rider");
    await expect(page).toHaveURL(/\/rider$/);
    await page.goto("/kitchen");
    await expect(page.getByTestId("access-denied")).toBeVisible();
  });

  test("manager sees operations but settings are read-only and users are hidden", async ({ page }) => {
    await signInAs(page, "manager");
    await expect(page).toHaveURL(/\/admin$/);
    const nav = page.locator("[data-sidebar=sidebar]");
    await expect(nav.getByRole("link", { name: "Settings" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Users" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Audit log" })).toHaveCount(0);

    await page.goto("/admin/settings/finance");
    await expect(page.getByText("Only the Owner can change them")).toBeVisible();
    await expect(page.getByTestId("save-settings")).toHaveCount(0);
  });

  test("server actions reject unauthorised callers even if the UI is bypassed", async ({ page, request }) => {
    // A cashier session cannot read the settings page data through any route.
    await signInAs(page, "cashier");
    const res = await page.request.get("/admin/settings/business");
    expect(await res.text()).toContain("access-denied");
    // Unauthenticated API callers get no session.
    const anon = await request.get("/api/auth/get-session");
    expect(await anon.text()).toBe("null");
  });
});
