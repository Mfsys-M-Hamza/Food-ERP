import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/** Accounts created by tests/e2e/reset-db.ts (test database only). */
export const E2E = {
  owner: { email: "owner@e2e.local", password: "OwnerPass2026" },
  demoPassword: "DemoPass2026",
  manager: "manager@demo.local",
  cashier: "cashier@demo.local",
  kitchen: "kitchen@demo.local",
  rider: "rider@demo.local",
};

export async function signIn(page: Page, email: string, password: string) {
  await page.goto("/staff/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/staff\/login/);
}

export async function signInAs(page: Page, who: "owner" | "manager" | "cashier" | "kitchen" | "rider") {
  if (who === "owner") return signIn(page, E2E.owner.email, E2E.owner.password);
  return signIn(page, E2E[who], E2E.demoPassword);
}
