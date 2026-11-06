import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, email: string, password = "timepeace") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
}

test("owner invites a worker; the worker joins through the link and can sign in", async ({ page, browser }) => {
  await login(page, "owner@acme.test");
  await page.getByRole("link", { name: "Team", exact: true }).click();
  await page.getByRole("button", { name: "Invite someone" }).click();
  await page.getByLabel("Name").fill("Pat Newhire");
  await page.getByLabel("Email (their sign-in)").fill("pat.newhire@example.test");
  await page.getByLabel("Mobile (optional, to text the link)").fill("303-555-0123");
  await page.getByLabel("Classification").selectOption("CONTRACTOR_1099");
  await page.getByLabel("Starting pay ($/hour, optional)").fill("31.50");
  await page.getByRole("button", { name: "Create invite link" }).click();

  const link = await page.getByLabel("Invite link (shown once)").inputValue();
  expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{40,}$/);
  await expect(page.getByRole("link", { name: "Text it" })).toHaveAttribute("href", /^sms:3035550123\?&body=.*invite/);
  await expect(page.getByRole("row", { name: /Pat Newhire/ })).toContainText("Waiting");

  // The new hire opens the link in their own browser.
  const ctx = await browser.newContext();
  const hire = await ctx.newPage();
  await hire.goto(new URL(link).pathname);
  await expect(hire.getByText(/invited you to join Acme Homes as field worker/)).toBeVisible();
  await hire.getByLabel(/Choose a password/).fill("pat-secret-pass");
  await hire.getByLabel("Confirm password").fill("pat-secret-pass");
  await hire.getByRole("button", { name: "Join Acme Homes" }).click();
  await expect(hire.getByText(/You're in, Pat Newhire/)).toBeVisible();

  // Link is single-use.
  await hire.goto(new URL(link).pathname);
  await expect(hire.getByText(/isn't valid anymore/)).toBeVisible();
  await ctx.close();

  // Owner sees them as a member with the starting rate, and no longer as pending.
  await page.reload();
  const row = page.getByRole("row", { name: /Pat Newhire/ });
  await expect(row).toContainText("1099 contractor");
  await expect(row).toContainText("$31.50/hr");
  await expect(page.getByText("No pending invites.")).toBeVisible();

  // Fresh sign-in works.
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await login(p2, "pat.newhire@example.test", "pat-secret-pass");
  await ctx2.close();
});

test("managers can only invite field workers and don't see pay", async ({ page }) => {
  await login(page, "manager@acme.test");
  await page.getByRole("link", { name: "Team", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "Pay" })).toHaveCount(0);
  await page.getByRole("button", { name: "Invite someone" }).click();
  await expect(page.getByLabel("Role")).toBeDisabled();
  await expect(page.getByLabel("Role")).toHaveValue("WORKER");
  await expect(page.getByLabel(/Starting pay/)).toHaveCount(0);
});

test("deactivating a worker signs them out", async ({ page, browser }) => {
  const ctx = await browser.newContext();
  const worker = await ctx.newPage();
  await login(worker, "dana@acme.test");

  await login(page, "owner@acme.test");
  await page.goto("/team");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("row", { name: /Dana/ }).getByRole("button", { name: "Deactivate" }).click();
  await expect(page.getByRole("row", { name: /Dana/ })).toHaveCount(0);

  await worker.goto("/login");
  await worker.getByLabel("Email").fill("dana@acme.test");
  await worker.getByLabel("Password").fill("timepeace");
  await worker.getByRole("button", { name: "Sign in" }).click();
  await expect(worker.getByText("Invalid email or password")).toBeVisible();
  await ctx.close();

  await page.getByLabel(/Show deactivated/).check();
  await page.getByRole("row", { name: /Dana/ }).getByRole("button", { name: "Reactivate" }).click();
  await expect(page.getByRole("row", { name: /Dana/ }).getByRole("button", { name: "Deactivate" })).toBeVisible();
});
