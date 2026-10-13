import { expect, test, type Browser, type Page } from "@playwright/test";
import { signInAs } from "./accounts";

test.describe.configure({ mode: "serial" });

async function session(browser: Browser, who: "cashier" | "kitchen" | "rider" | "manager") {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAs(page, who);
  return page;
}

async function ensureShift(pos: Page) {
  const open = pos.getByRole("button", { name: "Open shift" });
  if (await open.isVisible().catch(() => false)) {
    await open.click();
    await pos.getByLabel("Opening cash").fill("2000");
    await pos.getByTestId("open-shift").click();
  }
  await expect(pos.getByTestId("shift-button")).toBeVisible();
}

async function successNumber(pos: Page) {
  const text = await pos.getByTestId("success-number").textContent();
  const n = Number((text ?? "").replace("#", ""));
  await pos.getByRole("button", { name: "New order" }).click();
  return n;
}

test("kitchen, order board and rider update live", async ({ browser }) => {
  const pos = await session(browser, "cashier");
  await expect(pos.getByTestId("product-Zinger Burger")).toBeVisible();
  await ensureShift(pos);

  const kitchen = await session(browser, "kitchen");
  await expect(kitchen).toHaveURL(/\/kitchen$/);
  await expect(kitchen.getByText("Kitchen", { exact: true })).toBeVisible();

  const board = await session(browser, "manager");
  await board.goto("/display");
  await expect(board.getByText("Ready — please collect")).toBeVisible();

  // 1. Takeaway paid at the counter
  await pos.getByTestId("product-Mineral Water").click();
  await pos.getByTestId("charge").click();
  await pos.getByRole("radio", { name: "Card" }).click();
  await pos.getByTestId("confirm-payment").click();
  const takeaway = await successNumber(pos);

  // 2. Delivery, cash on delivery
  await pos.getByRole("radio", { name: "Delivery" }).click();
  await pos.getByTestId("customer-button").click();
  await pos.getByLabel("Search customers").fill("Sana");
  await pos.getByRole("button", { name: /Sana Tariq/ }).click();
  await pos.getByTestId("save-customer").click();
  await pos.getByTestId("product-Loaded Fries").click();
  await pos.getByTestId("pay-later").click();
  const delivery = await successNumber(pos);

  // Kitchen receives both without reloading
  const t1 = kitchen.getByTestId(`kds-ticket-${takeaway}`);
  const t2 = kitchen.getByTestId(`kds-ticket-${delivery}`);
  await expect(t1).toBeVisible({ timeout: 15_000 });
  await expect(t2).toBeVisible({ timeout: 15_000 });
  await expect(t2).toContainText("Loaded Fries");
  await expect(board.getByTestId("board-preparing")).toContainText(String(takeaway), { timeout: 15_000 });

  await kitchen.getByTestId(`kds-start-${takeaway}`).click();
  await kitchen.getByTestId(`kds-ready-${takeaway}`).click();
  await kitchen.getByTestId(`kds-start-${delivery}`).click();
  await kitchen.getByTestId(`kds-ready-${delivery}`).click();
  await expect(board.getByTestId("board-ready")).toContainText(String(takeaway), { timeout: 15_000 });

  // Assign rider from the POS
  await pos.getByTestId("orders-button").click();
  const row = pos.getByTestId(`pos-order-${delivery}`);
  await expect(row).toContainText("Ready", { timeout: 15_000 });
  await row.getByRole("button", { name: "Assign rider" }).click();
  await pos.getByRole("menuitem", { name: /Hamid Raza/ }).click();
  await expect(row.getByRole("button", { name: "Hamid Raza" })).toBeVisible();
  await pos.keyboard.press("Escape");

  // Rider delivers
  const rider = await session(browser, "rider");
  await expect(rider).toHaveURL(/\/rider$/);
  const card = rider.getByTestId(`delivery-${delivery}`);
  await expect(card).toBeVisible();
  await expect(rider.getByTestId(`collect-${delivery}`)).toHaveText("Rs 670"); // 550 + 120 Gulberg
  await rider.getByTestId(`pickup-${delivery}`).click();
  await rider.getByTestId(`delivered-${delivery}`).click();
  await expect(card).toBeHidden();

  // Cashier receives rider cash into the shift
  await pos.getByTestId("rider-cash-button").click();
  const riderCash = pos.getByTestId("rider-cash-Hamid Raza");
  await expect(riderCash).toContainText("Rs 670");
  await riderCash.getByRole("button", { name: /Receive/ }).click();
  await expect(pos.getByText("Received Rs 670 from Hamid Raza")).toBeVisible();
});
