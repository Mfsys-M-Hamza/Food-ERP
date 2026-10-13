import { expect, test } from "@playwright/test";
import { signInAs } from "./accounts";

test.describe.configure({ mode: "serial" });

// 1×1 transparent PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("records a bank expense with a receipt photo", async ({ page, playwright }) => {
  await signInAs(page, "manager");
  await page.goto("/admin/expenses");
  await page.getByTestId("new-expense").click();
  const dialog = page.getByRole("dialog", { name: "Record an expense" });
  await dialog.getByLabel("Category").selectOption({ label: "Electricity" });
  await dialog.getByLabel("Amount (Rs)").fill("12500");
  await dialog.getByRole("button", { name: "Bank transfer" }).click();
  await dialog.getByLabel("What was it for?").fill("Generator repair E2E");
  await dialog.getByLabel("Receipt photo or PDF (optional)").setInputFiles({ name: "bill.png", mimeType: "image/png", buffer: PNG });
  await dialog.getByTestId("save-expense").click();
  await expect(page.getByText(/EXP-\d+ recorded/)).toBeVisible();
  await page.getByRole("link", { name: "Generator repair E2E" }).click();
  await expect(page.getByRole("heading", { name: /EXP-\d+ · Rs 12,500/ })).toBeVisible();
  await expect(page.getByTestId("receipt-image")).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: "Bank transfer" })).toBeVisible();
  // The receipt is private: anonymous requests are refused.
  const src = await page.getByTestId("receipt-image").getAttribute("src");
  const anon = await playwright.request.newContext();
  expect((await anon.get(new URL(src!, page.url()).toString())).status()).toBe(401);
  await anon.dispose();
});

test("adds an employee with a salary and marks attendance", async ({ page }) => {
  await signInAs(page, "manager");
  await page.goto("/admin/employees/new");
  await page.getByLabel("Full name").fill("Zara Test");
  await page.getByLabel("Job title").fill("Waiter");
  await page.getByLabel("Shift", { exact: true }).selectOption({ index: 1 });
  await page.getByLabel("Monthly salary (Rs)").fill("40000");
  await page.getByLabel("CNIC").fill("35202-7654321-9");
  await page.getByTestId("save-employee").click();
  await expect(page).toHaveURL(/\/admin\/employees\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Zara Test" })).toBeVisible();

  await page.goto("/admin/attendance");
  const row = page.getByTestId("attendance-Zara Test");
  await row.getByLabel("Zara Test status").selectOption("PRESENT");
  await row.getByLabel("Zara Test check in").fill("11:40");
  await row.getByRole("button", { name: "Save Zara Test" }).click();
  await expect(page.getByText(/Zara Test: Late, \d+ min late/)).toBeVisible();
});

test("prepares, adjusts, approves and pays last month's payroll", async ({ page }) => {
  await signInAs(page, "owner");
  await page.goto("/admin/payroll");
  await page.getByTestId("new-payroll").click();
  await page.getByTestId("create-payroll").click();
  await expect(page).toHaveURL(/\/admin\/payroll\/[0-9a-f-]{36}$/);
  const card = page.getByTestId("payslip-Bilal Ahmed");
  await expect(card).toBeVisible();
  const before = await card.getByTestId("payslip-net").textContent();

  await card.getByTestId("add-line-Bilal Ahmed").click();
  await page.getByLabel("Description").fill("Eid bonus");
  await page.getByLabel("Amount").fill("5000");
  await page.getByTestId("save-line").click();
  await expect(card.getByText("Eid bonus")).toBeVisible();
  await expect(card.getByTestId("payslip-net")).not.toHaveText(before!);

  page.once("dialog", (d) => void d.accept());
  await page.getByTestId("approve-payroll").click();
  await expect(page.getByText("Approved: record payments")).toBeVisible();
  await expect(card.getByTestId("add-line-Bilal Ahmed")).toHaveCount(0);

  await page.getByTestId("pay-all").click();
  await page.getByTestId("confirm-pay").click();
  await expect(page.getByText("Paid", { exact: true }).first()).toBeVisible();

  const slip = await card.getByRole("link", { name: "Salary slip" }).getAttribute("href");
  await page.goto(slip!.replace("?auto=1", ""));
  await expect(page.getByTestId("payslip-print")).toContainText("Bilal Ahmed");
  await expect(page.getByTestId("payslip-print")).toContainText("Eid bonus");

  await page.goto("/admin/expenses?q=Salary");
  await expect(page.getByRole("link", { name: /Salary PR-/ }).first()).toBeVisible();
});

test("a kitchen employee checks in and out from their phone", async ({ page }) => {
  await signInAs(page, "kitchen");
  await page.goto("/kitchen");
  await page.getByRole("link", { name: "My time clock" }).click();
  await expect(page).toHaveURL(/\/admin\/clock$/);
  await page.getByTestId("check-in").click();
  await expect(page.getByTestId("clock-state")).toContainText("Checked in at");
  await page.getByTestId("check-out").click();
  await expect(page.getByTestId("clock-state")).toContainText("Worked");
});

test("a cashier only sees cash expenses and cannot open payroll", async ({ page }) => {
  await signInAs(page, "cashier");
  await page.goto("/admin/expenses");
  await expect(page.getByText("Cash you have paid from your till.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Generator repair E2E" })).toHaveCount(0);
  await page.goto("/admin/payroll");
  await expect(page.getByTestId("access-denied")).toBeVisible();
});
