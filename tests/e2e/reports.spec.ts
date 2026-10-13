import { expect, test } from "@playwright/test";
import { signInAs } from "./accounts";

test("owner opens daily sales, switches period and exports Excel and CSV", async ({ page }) => {
  await signInAs(page, "owner");
  await page.goto("/admin");
  await expect(page.getByTestId("kpi-sales")).toBeVisible();
  await page.getByRole("link", { name: "Reports", exact: true }).click();
  await page.getByRole("link", { name: /Daily sales/ }).click();
  await expect(page.getByRole("heading", { name: "Daily sales" })).toBeVisible();
  await expect(page.getByTestId("tile-Net sales")).toBeVisible();
  await page.getByRole("link", { name: "Last 30 days" }).click();
  await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}&to=/);
  await expect(page.getByTestId("report-table")).toBeVisible();

  const xlsx = await page.request.get((await page.getByTestId("export-xlsx").getAttribute("href"))!);
  expect(xlsx.status()).toBe(200);
  expect(xlsx.headers()["content-type"]).toContain("spreadsheetml");
  expect((await xlsx.body()).subarray(0, 2).toString()).toBe("PK");
  const csv = await page.request.get((await page.getByTestId("export-csv").getAttribute("href"))!);
  expect(await csv.text()).toContain("Net sales");
});

test("profit report and print layout for the owner", async ({ page }) => {
  await signInAs(page, "owner");
  await page.goto("/admin/reports/profit");
  await expect(page.getByTestId("tile-Estimated net profit")).toBeVisible();
  await expect(page.getByText("This is an estimate for running the business")).toBeVisible();
  await page.goto("/print/report/inventory");
  await expect(page.getByTestId("report-print")).toContainText("Stock valuation");
});

test("managers get operational reports but not profit or payroll; cashiers get none", async ({ page }) => {
  await signInAs(page, "manager");
  await page.goto("/admin/reports");
  await expect(page.getByRole("link", { name: /Product sales/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Estimated profit/ })).toHaveCount(0);
  await page.goto("/admin/reports/profit");
  await expect(page.getByTestId("access-denied")).toBeVisible();
  const res = await page.request.get("/api/v1/reports/payroll?format=csv");
  expect(res.status()).toBe(403);

  await page.context().clearCookies();
  await signInAs(page, "cashier");
  const denied = await page.request.get("/api/v1/reports/sales?format=csv");
  expect(denied.status()).toBe(403);
});
