import { expect, test } from "@playwright/test";
import { signInAs } from "./accounts";

test.describe("menu management", () => {
  test("owner creates a category and a product with sizes and add-ons", async ({ page }) => {
    await signInAs(page, "owner");
    await page.goto("/admin/menu/categories");
    await page.getByRole("button", { name: "New category" }).click();
    await page.getByLabel("Name").fill("Wraps");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("category-Wraps")).toBeVisible();

    await page.goto("/admin/menu/products/new");
    await page.getByLabel("Name", { exact: true }).fill("Chicken Wrap");
    await page.locator("#categoryId").click();
    await page.getByRole("option", { name: "Wraps" }).click();
    await page.getByRole("button", { name: "Add size" }).click();
    await page.getByLabel("Size 1 name").fill("Regular");
    await page.getByLabel("Size 1 price").fill("450");
    await page.getByRole("button", { name: "Add size" }).click();
    await page.getByLabel("Size 2 name").fill("Jumbo");
    await page.getByLabel("Size 2 price").fill("650");
    await page.getByRole("checkbox", { name: "Dips & sauces" }).click();
    await page.getByTestId("save-product").click();

    await expect(page.getByRole("heading", { name: "Chicken Wrap" })).toBeVisible();
    await expect(page.getByText(/SKU CW-\d{3}/)).toBeVisible();

    await page.goto("/admin/menu/products?q=wrap");
    await expect(page.getByRole("cell", { name: /Chicken Wrap CW-/ })).toBeVisible();
    await expect(page.getByRole("cell", { name: /Rs 450 – 650/ })).toBeVisible();
  });

  test("shows validation errors for a bad price", async ({ page }) => {
    await signInAs(page, "owner");
    await page.goto("/admin/menu/products/new");
    await page.getByLabel("Name", { exact: true }).fill("Broken");
    await page.getByLabel("Selling price").fill("abc");
    await page.getByTestId("save-product").click();
    await expect(page.getByText("Enter an amount like 450 or 450.50")).toBeVisible();
  });

  test("marks a product out of stock from the list", async ({ page }) => {
    await signInAs(page, "owner");
    await page.goto("/admin/menu/products?q=Lava");
    const toggle = page.getByTestId("availability-Chocolate Lava Cake");
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(page.getByText("Chocolate Lava Cake: out of stock")).toBeVisible();
    await page.goto("/admin/menu/products?status=out");
    await expect(page.getByRole("cell", { name: /Chocolate Lava Cake DS-LAVA/ })).toBeVisible();
  });

  test("edits an add-on group", async ({ page }) => {
    await signInAs(page, "owner");
    await page.goto("/admin/menu/addon-groups");
    await page.getByRole("button", { name: "Edit Dips & sauces" }).click();
    await page.getByRole("button", { name: "Add option" }).click();
    await page.getByLabel("Option 4 name").fill("BBQ sauce");
    await page.getByLabel("Option 4 price").fill("60");
    await page.getByRole("button", { name: "Save group" }).click();
    await expect(page.getByTestId("addon-group-Dips & sauces")).toContainText("BBQ sauce");
  });

  test("manager can manage the menu; cashier cannot open the editor", async ({ page }) => {
    await signInAs(page, "cashier");
    await page.goto("/admin/menu/products/new");
    await expect(page.getByTestId("access-denied")).toBeVisible();
  });
});
