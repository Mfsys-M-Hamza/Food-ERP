import { expect, test } from "@playwright/test";
import { signIn, signInAs } from "./accounts";

test.describe("owner administration", () => {
  test("updates the business profile, shows it everywhere and records it in the audit log", async ({ page }) => {
    await signInAs(page, "owner");
    await page.goto("/admin/settings/business");
    const name = `Zinger Point ${Date.now() % 10000}`;
    await page.getByLabel("Restaurant name").fill(name);
    await page.getByTestId("save-settings").click();
    await expect(page.getByText("Settings saved")).toBeVisible();
    await expect(page.locator("header")).toContainText(name);

    // Public home page reads the same settings.
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);

    await page.goto("/admin/audit?module=settings");
    const list = page.getByTestId("audit-list");
    await expect(list).toContainText("settings.update");
    await list.getByRole("button", { name: /field/ }).first().click();
    await expect(list).toContainText(name);
  });

  test("shows validation errors from the server schema", async ({ page }) => {
    await signInAs(page, "owner");
    await page.goto("/admin/settings/delivery");
    await page.getByLabel("Default delivery charge").fill("12.345");
    await page.getByTestId("save-settings").click();
    await expect(page.getByText("Enter an amount like 150 or 150.50")).toBeVisible();
  });

  test("saves opening hours", async ({ page }) => {
    await signInAs(page, "owner");
    await page.goto("/admin/settings/hours");
    await page.getByRole("switch", { name: "Sunday open" }).click();
    await page.getByRole("button", { name: "Save hours" }).click();
    await expect(page.getByText("Opening hours saved")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("switch", { name: "Sunday open" })).not.toBeChecked();
  });

  test("creates a cashier who can then sign in", async ({ page }) => {
    await signInAs(page, "owner");
    await page.goto("/admin/users/new");
    const email = `new.cashier.${Date.now()}@e2e.local`;
    await page.getByLabel("Full name").fill("Nadia Cashier");
    await page.getByLabel("E-mail (used to sign in)").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("CashierPass2026");
    await page.getByRole("checkbox", { name: "Cashier" }).click();
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Nadia Cashier" })).toBeVisible();

    await page.getByTestId("user-menu").click();
    await page.getByTestId("sign-out").click();
    await signIn(page, email, "CashierPass2026");
    await expect(page).toHaveURL(/\/pos$/);
  });

  test("disabled users cannot sign in", async ({ page }) => {
    await signInAs(page, "owner");
    await page.goto("/admin/users/new");
    const email = `temp.rider.${Date.now()}@e2e.local`;
    await page.getByLabel("Full name").fill("Temporary Rider");
    await page.getByLabel("E-mail (used to sign in)").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("RiderPass2026");
    await page.getByRole("checkbox", { name: "Rider" }).click();
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Temporary Rider" })).toBeVisible();

    await page.getByLabel(/Account active/).click();
    await page.getByRole("button", { name: "Save changes" }).first().click();
    await expect(page.getByText("Changes saved")).toBeVisible();

    await page.getByTestId("user-menu").click();
    await page.getByTestId("sign-out").click();
    await page.goto("/staff/login");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("RiderPass2026");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "incorrect" })).toBeVisible();
    await expect(page).toHaveURL(/\/staff\/login/);
  });

  test("edits role permissions in the matrix", async ({ page }) => {
    await signInAs(page, "owner");
    await page.goto("/admin/roles");
    const box = page.getByTestId("perm-cashier-customers.export");
    await expect(box).not.toBeChecked();
    await box.click();
    await page.getByTestId("save-permissions").click();
    await expect(page.getByText("Permissions saved")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("perm-cashier-customers.export")).toBeChecked();
    await expect(page.getByTestId("perm-owner-pos.use")).toBeDisabled();
  });
});
