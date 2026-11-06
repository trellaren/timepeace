import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("timepeace");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
}

test("manager creates a project from a template and assigns a worker", async ({ page }) => {
  await login(page, "manager@acme.test");
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Project name").fill("E2E Aspen Ct Lot 3");
  await page.getByLabel("Client").fill("E2E Client");
  await page.getByLabel("Start from template").selectOption({ label: "Single-family new build" });
  await page.getByLabel("Contract value ($)").fill("350000");
  await page.getByRole("button", { name: "Create project" }).click();

  await expect(page.getByRole("heading", { name: "E2E Aspen Ct Lot 3" })).toBeVisible();
  await expect(page.getByText("Stake lot & set grade")).toBeVisible();

  const row = page.getByRole("row", { name: /Stake lot & set grade/ });
  await row.getByRole("combobox").nth(1).selectOption({ label: "Sam Whitaker" });
  await expect(row.getByText("Sam")).toBeVisible();

  await page.getByRole("button", { name: "Budget & job cost" }).click();
  await expect(page.getByText("Budget vs actual by cost code")).toBeVisible();
});

test("manager approves timesheets; HR exports payroll CSV with the approved hours", async ({ page }) => {
  await login(page, "manager@acme.test");
  await page.goto("/approvals?tab=timesheets");
  const jakeCard = page.locator("section", { hasText: "Jake Turner" });
  const overtime = await jakeCard.getByText(/^Overtime/).innerText();
  const otMatch = /(\d+)h (\d+)m/.exec(overtime)!;
  const jakeOtHours = Number(otMatch[1]) + Number(otMatch[2]) / 60;
  expect(jakeOtHours).toBeGreaterThan(0);

  await page.getByRole("button", { name: /Approve all/ }).click();
  await expect(page.getByText("No timesheets waiting for approval")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();

  await login(page, "hr@acme.test");
  await page.getByRole("link", { name: "Payroll", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Jake Turner" })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const download = await downloadPromise;
  const csv = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString("utf8"));
  const lines = csv.trim().split("\r\n");
  expect(lines[0]).toContain("overtime_hours");
  const jake = lines.find((l) => l.startsWith("Jake Turner"))!.split(",");
  expect(Number(jake[6])).toBeCloseTo(jakeOtHours, 2);

  await page.getByRole("button", { name: "Mark paid" }).click();
  await expect(page.getByText(/paid \d/)).toBeVisible();
});
