import { expect, test, type Page } from "@playwright/test";
import { signInAs } from "./accounts";

test.describe.configure({ mode: "serial" });

async function openPos(page: Page) {
  await signInAs(page, "cashier");
  await expect(page).toHaveURL(/\/pos$/);
  await expect(page.getByTestId("product-Zinger Burger")).toBeVisible();
}

test.describe("POS", () => {
  test("opens a shift and sells items with options for cash with change", async ({ page }) => {
    await openPos(page);
    await page.getByRole("button", { name: "Open shift" }).click();
    await page.getByLabel("Opening cash").fill("5000");
    await page.getByTestId("open-shift").click();
    await expect(page.getByTestId("shift-button")).toBeVisible();

    await page.getByTestId("product-Zinger Burger").click(); // one tap: optional extras only
    await page.getByTestId("product-Chicken Tikka Pizza").click();
    await page.getByRole("button", { name: /^Large/ }).click();
    await page.getByRole("button", { name: /^Extra cheese/ }).click();
    await page.getByTestId("add-to-order").click();

    const cart = page.getByTestId("cart-lines");
    await expect(cart).toContainText("Zinger Burger");
    await expect(cart).toContainText("Chicken Tikka Pizza · Large");
    await expect(cart).toContainText("+ Extra cheese");
    await expect(page.getByTestId("cart-total")).toHaveText("Rs 2,539");

    await page.getByTestId("charge").click();
    await expect(page.getByTestId("amount-due")).toHaveText("Rs 2,539");
    await page.getByRole("button", { name: "Rs 5,000" }).click();
    await expect(page.getByTestId("change-due")).toHaveText("Rs 2,461");
    await page.getByTestId("confirm-payment").click();

    const success = page.getByTestId("order-success");
    await expect(success).toContainText("#1");
    await expect(success).toContainText("Rs 2,461");
    await page.getByRole("button", { name: "New order" }).click();
    await expect(page.getByText("Tap items to start an order.")).toBeVisible();
  });

  test("requires the deal choices before adding", async ({ page }) => {
    await openPos(page);
    await page.getByTestId("product-Solo Deal").click();
    const add = page.getByTestId("add-to-order");
    await expect(add).toBeDisabled();
    await page.getByRole("button", { name: /^Zinger burger/ }).click();
    await page.getByRole("button", { name: /^Sprite/ }).click();
    await expect(add).toBeEnabled();
    await add.click();
    await expect(page.getByTestId("cart-lines")).toContainText("+ Sprite");
    await page.getByRole("button", { name: "Clear" }).click();
  });

  test("takes a phone delivery order to pay later and moves it through the kitchen", async ({ page }) => {
    await openPos(page);
    await page.getByRole("radio", { name: "Delivery" }).click();
    await page.getByTestId("customer-button").click();
    await page.getByLabel("Search customers").fill("0300111000");
    await page.getByRole("button", { name: /Ali Raza/ }).click();
    await expect(page.getByLabel("Address", { exact: true })).toHaveValue(/DHA Phase 5/);
    await page.getByTestId("save-customer").click();
    await page.getByTestId("product-Zinger Burger").click();
    await expect(page.getByTestId("cart-total")).toHaveText("Rs 740"); // 590 + 150 delivery
    await page.getByTestId("pay-later").click();
    await expect(page.getByTestId("order-success")).toContainText("Not paid yet");
    await page.getByRole("button", { name: "New order" }).click();

    await page.getByTestId("orders-button").click();
    const row = page.getByTestId("pos-order-2");
    await expect(row).toContainText("Due Rs 740");
    await row.getByRole("button", { name: "Preparing" }).click();
    await expect(row.getByRole("button", { name: "Ready" })).toBeVisible();
    await row.getByRole("button", { name: "Take payment" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Cash" }).click();
    await expect(row).not.toContainText("Due");
  });

  test("needs a manager PIN for a big discount", async ({ page }) => {
    await openPos(page);
    await page.getByTestId("product-Zinger Burger").click();
    await page.getByRole("button", { name: "Discount" }).click();
    await page.getByRole("button", { name: "50%" }).click();
    await page.getByLabel("Discount reason").fill("Complaint");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByTestId("cart-total")).toHaveText("Rs 295");
    await page.getByTestId("charge").click();
    await page.getByRole("radio", { name: "Card" }).click();
    await page.getByTestId("confirm-payment").click();
    await expect(page.getByText("Manager approval")).toBeVisible();
    for (const d of "2222") await page.getByRole("button", { name: d, exact: true }).click();
    await page.getByTestId("approve-pin").click();
    await expect(page.getByTestId("order-success")).toBeVisible();
    await page.getByRole("button", { name: "New order" }).click();
  });

  test("prints a receipt with totals and payment", async ({ page }) => {
    await signInAs(page, "cashier");
    await page.goto("/admin/orders?q=1");
    await page.getByRole("link", { name: /#1 / }).first().click();
    await page.waitForURL(/\/admin\/orders\/[0-9a-f-]{36}$/);
    const id = page.url().split("/").pop();
    await page.goto(`/print/receipt/${id}`);
    const r = page.getByTestId("receipt");
    await expect(r).toContainText("Chicken Tikka Pizza (Large)");
    await expect(r).toContainText("TOTAL");
    await expect(r).toContainText("Rs 2,539");
    await expect(r).toContainText("Change");
    await page.goto(`/print/kot/${id}`);
    await expect(page.getByTestId("kot")).toContainText("1 × Zinger Burger");
  });

  test("switches user with a PIN", async ({ page }) => {
    await openPos(page);
    await page.getByTestId("pos-user-menu").click();
    await page.getByRole("menuitem", { name: "Switch user" }).click();
    await page.getByRole("button", { name: "Ayesha Khan" }).click();
    for (const d of "9999") await page.getByRole("button", { name: d, exact: true }).click();
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toContainText(/Incorrect PIN/);
    for (const d of "2222") await page.getByRole("button", { name: d, exact: true }).click();
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByTestId("user-menu")).toContainText("Ayesha Khan");
  });

  test("closes the shift with expected vs counted cash", async ({ page }) => {
    await openPos(page);
    await page.getByTestId("shift-button").click();
    await expect(page.getByTestId("expected-cash")).toHaveText("Rs 8,279"); // 5000 + 2539 + 740
    await page.getByRole("tab", { name: "Close shift" }).click();
    await page.getByLabel("Number of 5000 notes").fill("1");
    await page.getByLabel("Number of 1000 notes").fill("3");
    await page.getByLabel("Number of 100 notes").fill("2");
    await expect(page.getByTestId("counted-cash")).toHaveText("Rs 8,200");
    await page.getByTestId("close-shift").click();
    await expect(page.getByText("Short Rs 79")).toBeVisible();
  });

  test("manager approves the shift and refunds an order", async ({ page }) => {
    await signInAs(page, "manager");
    await page.goto("/admin/cash-shifts?status=CLOSED");
    await page.getByRole("link", { name: /SH-/ }).first().click();
    await page.getByTestId("approve-shift").click();
    await expect(page.getByText("Approved by Ayesha Khan")).toBeVisible();

    await page.goto("/admin/orders?q=1");
    await page.getByRole("link", { name: /#1 / }).first().click();
    await page.getByTestId("refund-button").click();
    await page.getByRole("dialog").getByRole("button", { name: "Card" }).click();
    await page.getByLabel("Amount").fill("590");
    await page.getByLabel("Reason").fill("Burger was cold");
    await page.getByTestId("confirm-action").click();
    await expect(page.getByText(/Refund RF-00001/)).toBeVisible();
  });
});
