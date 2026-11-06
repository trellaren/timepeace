import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const API = `http://localhost:${process.env.E2E_API_PORT ?? 4010}`;
// A real 1×1 PNG, so the browser can decode and resize it like a phone photo.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("timepeace");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
}

/** Jake asks a question from his phone: the same offline op the mobile app sends. */
async function askFromThePhone(request: APIRequestContext, body: string) {
  const login = await request.post(`${API}/trpc/auth.login`, { data: { json: { email: "jake@acme.test", password: "timepeace" } } });
  const token = (await login.json()).result.data.json.token as string;
  const headers = { authorization: `Bearer ${token}` };
  const day = await request.get(`${API}/trpc/field.myDay`, { headers });
  const task = (await day.json()).result.data.json.tasks[0] as { id: string; title: string; project: { id: string; name: string } };
  const op = { opId: crypto.randomUUID(), type: "comment.create", at: new Date().toISOString(), payload: { commentId: crypto.randomUUID(), taskId: task.id, kind: "QUESTION", body } };
  const res = await request.post(`${API}/trpc/field.sync`, { headers, data: { json: { ops: [op] } } });
  expect((await res.json()).result.data.json[0].status).toBe("applied");
  return task;
}

test("a crew question reaches the office queue; a manager replies with a photo and it's answered", async ({ page, request }) => {
  const question = `Header over the slider: 2x10 or 2x12? (${Date.now()})`;
  const task = await askFromThePhone(request, question);

  await login(page, "manager@acme.test");
  const queue = page.locator("section").filter({ has: page.getByRole("heading", { name: /^Open questions/ }) });
  await expect(queue.getByText(question)).toBeVisible();
  await queue.getByText(question).click();

  await expect(page).toHaveURL(new RegExp(`/projects/${task.project.id}\\?task=${task.id}`));
  const panel = page.getByRole("dialog", { name: `Task: ${task.title}` });
  const asked = panel.getByRole("article", { name: "Question from Jake Turner" }).filter({ hasText: question });
  await expect(asked.getByText("Open question")).toBeVisible();

  await panel.getByRole("textbox", { name: "Message", exact: true }).fill("2x12, per sheet S-2.");
  await panel.locator('input[type="file"]').setInputFiles({ name: "header.png", mimeType: "image/png", buffer: PNG });
  await expect(panel.locator('form[aria-label="New message"] img')).toHaveCount(1);
  await panel.getByRole("button", { name: "Reply" }).click();

  await expect(asked.getByText("Answered by Marco")).toBeVisible();
  const reply = panel.getByRole("article", { name: "Note from Marco Reyes" }).filter({ hasText: "2x12, per sheet S-2." });
  await expect(reply.getByRole("button", { name: "Open photo" }).locator("img")).toHaveAttribute("src", /^blob:/);

  // The full-size photo opens and closes without closing the panel.
  await reply.getByRole("button", { name: "Open photo" }).click();
  await expect(page.getByRole("dialog", { name: "Photo" }).locator("img")).toHaveAttribute("src", /^blob:/);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Photo" })).toHaveCount(0);
  await expect(panel).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/projects/${task.project.id}$`));

  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByRole("heading", { name: /^Open questions/ })).toBeVisible();
  await expect(page.getByText(question)).toHaveCount(0);
});

test("the task table flags open questions, and accountants don't get discussions", async ({ page, request }) => {
  const question = `Which outlet height? (${Date.now()})`;
  const task = await askFromThePhone(request, question);

  await login(page, "manager@acme.test");
  await page.goto(`/projects/${task.project.id}`);
  await expect(page.getByRole("button", { name: /\d+ open questions?/ }).first()).toBeVisible();

  await page.getByRole("link", { name: "Sign out" }).or(page.getByRole("button", { name: "Sign out" })).click();
  await login(page, "accountant@acme.test");
  await page.goto(`/projects/${task.project.id}?task=${task.id}`);
  const panel = page.getByRole("dialog", { name: `Task: ${task.title}` });
  await expect(panel.getByText("Task discussions are for the crew and managers.")).toBeVisible();
  await expect(panel.getByRole("textbox", { name: "Message", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /open question/ })).toHaveCount(0);
});
