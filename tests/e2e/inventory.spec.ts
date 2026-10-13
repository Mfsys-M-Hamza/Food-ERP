import { expect, test } from "@playwright/test";
import { signInAs } from "./accounts";

test.describe.configure({ mode: "serial" });

test("receives a purchase in packs and stock goes up", async ({ page }) => {
  await signInAs(page, "manager");
  await page.goto("/admin/inventory?q=Burger bun");
  const row = page.getByTestId("ingredient-Burger bun");
  const before = Number((await row.getByRole("cell").nth(1).textContent())!.replace(/[^\d.]/g, ""));

  await page.goto("/admin/purchases/new");
  await page.getByLabel("Supplier", { exact: true }).selectOption({ label: "Lahore Bakery Supplies" });
  await page.getByLabel("Supplier invoice no.").fill(`E2E-${Date.now()}`);
  await page.getByLabel("Line 1 ingredient").selectOption({ label: "Burger bun" });
  await page.getByLabel("Line 1 quantity").fill("10");
  await page.getByLabel("Line 1 unit").selectOption("pack");
  await page.getByLabel("Line 1 price").fill("180");
  await expect(page.getByTestId("purchase-total")).toHaveText("Rs 1,800");
  await page.getByTestId("receive-purchase").click();
  await page.getByTestId("confirm-receive").click();
  await expect(page.getByText(/received/i).first()).toBeVisible();
  await expect(page.getByTestId("purchase-balance")).toHaveText("Rs 1,800");

  await page.goto("/admin/inventory?q=Burger bun");
  await expect(page.getByTestId("ingredient-Burger bun").getByRole("cell").nth(1)).toHaveText(`${before + 60} pcs`);
});

test("pays the supplier invoice", async ({ page }) => {
  await signInAs(page, "manager");
  await page.goto("/admin/purchases?payment=UNPAID&q=E2E");
  await page.getByRole("link", { name: /PO-/ }).first().click();
  await page.getByTestId("pay-supplier").click();
  await page.getByRole("button", { name: "Bank transfer" }).click();
  await page.getByTestId("confirm-supplier-payment").click();
  await expect(page.getByTestId("purchase-balance")).toHaveText("Rs 0");
});

test("edits a recipe and sees the food cost", async ({ page }) => {
  await signInAs(page, "owner");
  await page.goto("/admin/recipes");
  await page.getByRole("link", { name: "Zinger Burger" }).click();
  const card = page.getByTestId("recipe-base");
  await expect(card).toContainText("Burger bun");
  const before = await page.getByTestId("recipe-base-cost").textContent();
  await card.getByRole("button", { name: "Add ingredient" }).click();
  const rows = card.locator("select[aria-label^='Zinger Burger ingredient']");
  const last = (await rows.count()) - 1;
  await rows.nth(last).selectOption({ label: "Jalapeño" });
  await card.getByLabel(`Zinger Burger quantity ${last + 1}`).fill("10");
  await expect(page.getByTestId("recipe-base-cost")).not.toHaveText(before!);
  await page.getByTestId("recipe-base-save").click();
  await expect(page.getByText("Zinger Burger: recipe saved")).toBeVisible();
});

test("kitchen records wastage", async ({ page }) => {
  await signInAs(page, "kitchen");
  await page.goto("/admin/wastage");
  await page.getByTestId("record-wastage").click();
  await page.getByLabel("Ingredient").selectOption({ label: "Lettuce" });
  await page.getByLabel("Quantity").fill("0.5");
  await page.getByRole("button", { name: "Spoiled" }).click();
  await page.getByTestId("save-wastage").click();
  await expect(page.getByText(/WS-\d+ recorded/)).toBeVisible();
  await expect(page.getByRole("cell", { name: /Lettuce/ }).first()).toBeVisible();
});

test("counts stock and posts the variance", async ({ page }) => {
  await signInAs(page, "manager");
  await page.goto("/admin/inventory/counts");
  await page.getByRole("button", { name: "Start a count" }).click();
  await expect(page).toHaveURL(/\/admin\/inventory\/counts\/[0-9a-f-]{36}$/);
  await page.getByLabel("Counted Onion").fill("7500");
  await page.getByTestId("post-count").click();
  await page.getByRole("button", { name: "Post count" }).last().click();
  await expect(page.getByText(/Count posted/)).toBeVisible();
  await page.goto("/admin/inventory?q=Onion");
  await expect(page.getByTestId("ingredient-Onion").getByRole("cell").nth(1)).toHaveText("7.5 kg");
});
