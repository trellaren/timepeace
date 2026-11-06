import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import { readFileSync } from "node:fs";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("timepeace");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
}

test("managers don't see the tax center", async ({ page }) => {
  await login(page, "manager@acme.test");
  await expect(page.getByRole("link", { name: "Tax", exact: true })).toHaveCount(0);
});

test("accountant reviews the year, tracks a W-9, and downloads the CPA package", async ({ page }) => {
  await login(page, "accountant@acme.test");
  await page.getByRole("link", { name: "Tax", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tax center" })).toBeVisible();
  await expect(page.getByText("Net profit (estimate)")).toBeVisible();
  await expect(page.getByText(/Deductions by Form 1120-S line/)).toBeVisible();
  await expect(page.getByText(/expense\(s\) are in "Other"/)).toBeVisible();

  // 1099-NEC tracker: Peak Plumbing needs a W-9; record it.
  await page.getByRole("button", { name: "1099-NEC" }).click();
  const peak = page.getByRole("row", { name: /Peak Plumbing Co/ });
  await expect(peak.getByText("File 1099-NEC")).toBeVisible();
  await expect(peak.getByText(/Request a W-9/)).toBeVisible();
  await peak.getByRole("button", { name: "W-9" }).click();
  await page.getByLabel("W-9 on file").check();
  await page.getByLabel("Tax classification (W-9 line 3)").selectOption({ label: "LLC taxed as partnership" });
  await page.getByLabel(/SSN \/ EIN/).fill("84-7654321");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(peak.getByText("***4321")).toBeVisible();
  await expect(peak.getByText(/Request a W-9/)).toHaveCount(0);

  // Estimated taxes: four quarters, Q1–Q3 covered by the seeded payments.
  await page.getByRole("button", { name: "Estimated taxes" }).click();
  await expect(page.getByRole("row", { name: /^Q1/ }).getByText("Covered")).toBeVisible();
  await expect(page.getByRole("row", { name: /^Q4/ })).toBeVisible();

  // CPA package
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CPA package" }).click();
  const file = await (await download).path();
  const names = Object.keys(unzipSync(new Uint8Array(readFileSync(file))));
  expect(names).toEqual(expect.arrayContaining(["profit_and_loss.csv", "form_1099_nec.csv", "README.txt"]));
});
