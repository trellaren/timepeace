import { expect, test } from "@playwright/test";

const theme = (page: import("@playwright/test").Page) => page.evaluate(() => document.documentElement.dataset.theme);
const bodyBackground = (page: import("@playwright/test").Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test("System follows the device's dark mode", async ({ browser }) => {
  const ctx = await browser.newContext({ colorScheme: "dark" });
  const page = await ctx.newPage();
  await page.goto("/login");
  expect(await theme(page)).toBe("dark");
  expect(await bodyBackground(page)).toBe("rgb(18, 18, 17)");
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => theme(page)).toBe("light");
  await ctx.close();
});

test("a chosen theme applies at once, survives reloads and sign-in, and System clears it", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/login");
  const picker = page.getByLabel("Theme");
  await expect(picker).toHaveValue("system");

  await picker.selectOption("sunlight");
  expect(await theme(page)).toBe("sunlight");

  await page.reload();
  // Set by the inline script before React loads, so there's no flash of the light theme.
  expect(await theme(page)).toBe("sunlight");
  await expect(page.getByLabel("Theme")).toHaveValue("sunlight");

  await page.getByLabel("Email").fill("manager@acme.test");
  await page.getByLabel("Password").fill("timepeace");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  expect(await theme(page)).toBe("sunlight");

  await page.getByLabel("Theme").selectOption("system");
  expect(await theme(page)).toBe("light");
  expect(await page.evaluate(() => localStorage.getItem("timepeace.theme"))).toBeNull();
});
