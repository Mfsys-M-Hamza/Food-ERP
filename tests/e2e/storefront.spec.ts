import { expect, test } from "@playwright/test";
import { signInAs } from "./accounts";

test.describe.configure({ mode: "serial" });

test("guest orders online, the restaurant accepts it and tracking updates", async ({ page, browser }) => {
  await page.goto("/");
  await expect(page.getByTestId("store-status")).toContainText("Open now");
  await page.getByTestId("order-now").click();
  await expect(page).toHaveURL(/\/menu$/);

  // Item with options → dialog
  await page.getByTestId("menu-item-Zinger Burger").click();
  await page.getByRole("button", { name: /^Extra cheese slice/ }).click();
  await page.getByTestId("add-to-order").click();
  // Quick add
  await page.getByTestId("menu-item-Mineral Water").click();

  await page.getByTestId("cart-link").click();
  await expect(page.getByTestId("shop-cart")).toContainText("Zinger Burger");
  await expect(page.getByTestId("shop-subtotal")).toHaveText("Rs 770");
  await page.getByTestId("go-checkout").click();

  await page.getByLabel("Name").fill("Web Guest");
  await page.getByLabel("Mobile number").fill("0345 7778889");
  await page.getByRole("radio", { name: "Gulberg" }).click();
  await page.getByLabel("Full address").fill("House 21, Street 5, Gulberg III");
  await expect(page.getByTestId("checkout-total")).toHaveText("Rs 890");
  await page.getByTestId("place-order").click();

  await expect(page).toHaveURL(/\/order\/[A-Za-z0-9_-]+\?new=1/);
  await expect(page.getByText(/Thank you, Web!/)).toBeVisible();
  const number = (await page.getByTestId("tracking-number").textContent())!.replace("#", "");
  await expect(page.getByTestId("tracking-total")).toHaveText("Rs 890");

  // Restaurant accepts on the POS
  const posCtx = await browser.newContext();
  const pos = await posCtx.newPage();
  await signInAs(pos, "cashier");
  await pos.getByTestId("orders-button").click();
  const row = pos.getByTestId(`pos-order-${number}`);
  await expect(row).toContainText("WEBSITE");
  await row.getByRole("button", { name: "Accepted" }).click();
  await expect(row.getByRole("button", { name: "Preparing" })).toBeVisible();

  // Tracking page polls and shows the confirmation
  await expect(page.locator("[aria-current=step]")).toContainText("Confirmed by the restaurant", { timeout: 20_000 });
});

test("customer creates an account, orders and sees history", async ({ page }) => {
  const email = `cust${Date.now()}@example.com`;
  await page.goto("/account/register");
  await page.getByLabel("Name").fill("Maryam Aziz");
  await page.getByLabel("Mobile number").fill(`0312${String(Date.now()).slice(-7)}`);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Password").fill("Customer2026pw");
  await page.getByTestId("register").click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { name: "Hi, Maryam" })).toBeVisible();

  await page.goto("/menu");
  await page.getByTestId("menu-item-Mint Margarita").click();
  await page.goto("/checkout");
  await page.getByRole("radio", { name: "Pick up" }).click();
  await expect(page.getByLabel("Name")).toHaveValue("Maryam Aziz");
  await page.getByTestId("place-order").click();
  await expect(page).toHaveURL(/\/order\//);

  await page.goto("/account/orders");
  await expect(page.getByTestId("my-orders")).toContainText("Mint Margarita");
  await page.getByRole("button", { name: "Order again" }).first().click();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.getByTestId("shop-cart")).toContainText("Mint Margarita");
});

test("account pages require sign-in and staff accounts are kept separate", async ({ page }) => {
  await page.goto("/account/orders");
  await expect(page).toHaveURL(/\/account\/login/);
  await signInAs(page, "cashier");
  await page.goto("/account");
  await expect(page.getByText("You are signed in with a staff account")).toBeVisible();
});

test("app manifest and offline page are available", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m.display).toBe("standalone");
  expect(m.icons.length).toBeGreaterThan(1);
  expect((await request.get("/pwa-icon/192")).headers()["content-type"]).toContain("image/png");
  expect((await request.get("/sw.js")).ok()).toBe(true);
  expect((await request.get("/offline")).ok()).toBe(true);
});
