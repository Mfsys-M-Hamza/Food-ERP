import { expect, test } from "@playwright/test";
import { E2E, signIn, signInAs } from "./accounts";

test.describe("staff authentication", () => {
  test("redirects signed-out visitors from staff areas to the login page", async ({ page }) => {
    for (const path of ["/admin", "/admin/settings/business", "/pos", "/kitchen", "/rider"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/staff\/login\?next=/);
    }
  });

  test("shows a clear error for a wrong password", async ({ page }) => {
    await page.goto("/staff/login");
    await page.getByLabel("E-mail").fill(E2E.owner.email);
    await page.getByLabel("Password", { exact: true }).fill("definitely-wrong-1");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "incorrect" })).toContainText("incorrect");
    await expect(page).toHaveURL(/\/staff\/login/);
  });

  test("validates the form before submitting", async ({ page }) => {
    await page.goto("/staff/login");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Enter a valid e-mail")).toBeVisible();
  });

  test("owner signs in, sees the dashboard and signs out", async ({ page }) => {
    await signInAs(page, "owner");
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: /Welcome, Olivia/ })).toBeVisible();
    await expect(page.getByTestId("kpi-sales")).toBeVisible();

    await page.getByTestId("user-menu").click();
    await page.getByTestId("sign-out").click();
    await expect(page).toHaveURL(/\/staff\/login/);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/staff\/login/);
  });

  test("returns to the requested page after signing in", async ({ page }) => {
    await page.goto("/admin/audit");
    await expect(page).toHaveURL(/next=%2Fadmin%2Faudit/);
    await page.getByLabel("E-mail").fill(E2E.owner.email);
    await page.getByLabel("Password", { exact: true }).fill(E2E.owner.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/admin\/audit$/);
  });

  test("ignores external redirect targets", async ({ page }) => {
    await page.goto("/staff/login?next=https://evil.example.com");
    await signIn(page, E2E.owner.email, E2E.owner.password);
    await expect(page).toHaveURL(/localhost:3100\/admin/);
  });
});
