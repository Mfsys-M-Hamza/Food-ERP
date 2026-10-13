import { expect, test, type Page } from "@playwright/test";
import { signInAs } from "./accounts";

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe("responsive layout", () => {
  test("public home and login fit the screen", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoHorizontalScroll(page);

    await page.goto("/staff/login");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("storefront pages fit on phones and tablets", async ({ page }) => {
    for (const path of ["/", "/menu", "/cart", "/checkout", "/contact", "/account/login", "/account/register"]) {
      await page.goto(path);
      await expect(page.locator("main").first()).toBeVisible();
      await expectNoHorizontalScroll(page);
    }
    await page.goto("/menu");
    await page.getByTestId("menu-item-Mineral Water").click();
    if (page.viewportSize()!.width < 768) await expect(page.getByTestId("mobile-cart-bar")).toBeVisible();
  });

  test("admin pages fit and the sidebar opens from the menu button", async ({ page }) => {
    await signInAs(page, "owner");
    for (const path of ["/admin", "/admin/settings/business", "/admin/settings/hours", "/admin/users", "/admin/audit"]) {
      await page.goto(path);
      await expect(page.locator("main h1").first()).toBeVisible();
      await expectNoHorizontalScroll(page);
    }
    const viewport = page.viewportSize()!;
    if (viewport.width < 768) {
      await page.getByRole("button", { name: "Toggle Sidebar" }).click();
      await expect(page.getByRole("link", { name: "Users" })).toBeVisible();
    }
  });
});
