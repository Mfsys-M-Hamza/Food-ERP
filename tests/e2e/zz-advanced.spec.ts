import { expect, test, type Page } from "@playwright/test";
import { signInAs } from "./accounts";

test.describe.configure({ mode: "serial" });

async function guestCart(page: Page) {
  await page.goto("/menu");
  await page.getByTestId("menu-item-Mineral Water").click();
  await page.getByTestId("menu-item-Mineral Water").click();
  await page.getByTestId("cart-link").click();
  await page.getByTestId("go-checkout").click();
  await page.getByLabel("Name").fill("Coupon Guest");
  await page.getByLabel("Mobile number").fill("0345 1112223");
  const pickup = page.getByRole("radio", { name: "Pick up" });
  if (await pickup.isVisible()) await pickup.click();
}

test("owner creates a coupon and a guest uses it at checkout", async ({ page, browser }) => {
  await signInAs(page, "owner");
  await page.goto("/admin/coupons");
  await page.getByTestId("new-coupon").click();
  await page.getByLabel("Code customers type").fill("web50");
  await page.getByRole("button", { name: "Rs off" }).click();
  await page.getByLabel("Rupees off").fill("50");
  await page.getByLabel("Where").selectOption("ONLINE");
  await page.getByTestId("save-coupon").click();
  await expect(page.getByTestId("coupon-WEB50")).toContainText("Live");

  const guest = await (await browser.newContext()).newPage();
  await guestCart(guest);
  const before = await guest.getByTestId("checkout-total").textContent();
  await guest.getByLabel("Coupon code").fill("NOTREAL");
  await guest.getByTestId("apply-coupon").click();
  await expect(guest.getByTestId("coupon-error")).toContainText("not valid");
  await guest.getByLabel("Coupon code").fill("WEB50");
  await guest.getByTestId("apply-coupon").click();
  await expect(guest.getByRole("term").filter({ hasText: "Coupon WEB50" })).toBeVisible();
  await expect(guest.getByTestId("checkout-total")).not.toHaveText(before!);
  await guest.getByTestId("place-order").click();
  await expect(guest).toHaveURL(/\/order\/[A-Za-z0-9_-]+\?new=1/);

  await page.reload();
  await expect(page.getByTestId("coupon-WEB50")).toContainText("1");
});

test("staff get an alert in the bell for the new online order", async ({ page }) => {
  await signInAs(page, "manager");
  await page.goto("/admin");
  // The bell polls every 30 s.
  await expect(page.getByTestId("notification-count")).toBeVisible({ timeout: 40_000 });
  await page.getByTestId("notification-bell").click();
  await expect(page.getByRole("menuitem", { name: /New online order/ }).first()).toBeVisible();
  await page.getByText("Mark all read").click();
  await expect(page.getByTestId("notification-count")).toHaveCount(0);
});

test("the POS keeps cash sales while offline and syncs them afterwards", async ({ page, context }) => {
  await signInAs(page, "cashier");
  await expect(page.getByTestId("product-Zinger Burger")).toBeVisible();
  // The shift loads after the menu: wait until the header settles on one state.
  const open = page.getByRole("button", { name: "Open shift" });
  await expect(page.getByTestId("shift-button").or(open)).toBeVisible();
  await page.waitForLoadState("networkidle");
  if ((await page.getByTestId("shift-button").count()) === 0) {
    await open.click();
    await page.getByLabel("Opening cash").fill("3000");
    await page.getByTestId("open-shift").click();
  }
  await expect(page.getByTestId("shift-button")).toBeVisible();
  await page.getByTestId("product-Zinger Burger").click();

  await context.setOffline(true);
  await expect(page.getByTestId("offline-indicator")).toContainText("Offline");
  await page.getByTestId("charge").click();
  await expect(page.getByTestId("amount-due")).toHaveText("Rs 590");
  await page.getByTestId("confirm-payment").click();
  await expect(page.getByTestId("order-queued")).toContainText("Saved offline");
  await page.getByRole("button", { name: "New order" }).click();
  await expect(page.getByTestId("offline-indicator")).toContainText("1 to sync");

  await context.setOffline(false);
  await expect(page.getByText(/Offline sale synced as order #\d+/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("offline-indicator")).toHaveCount(0);
});

test("deliveries board and notifications page load for a manager", async ({ page }) => {
  await signInAs(page, "manager");
  await page.goto("/admin/deliveries");
  await expect(page.getByRole("heading", { name: "Needs a rider" })).toBeVisible();
  await page.goto("/admin/notifications");
  await expect(page.getByRole("heading", { name: "Notifications", exact: true })).toBeVisible();
});
