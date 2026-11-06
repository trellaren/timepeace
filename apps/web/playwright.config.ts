import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end: starts the API and web app against E2E_DATABASE_URL (a disposable database whose
 * name ends in _test or _e2e). The demo seed is reloaded before the run.
 */
const API_PORT = Number(process.env.E2E_API_PORT ?? 4010);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3010);
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/globalSetup.ts",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${WEB_PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @timepeace/api start",
      url: `http://localhost:${API_PORT}/health`,
      env: { DATABASE_URL, API_PORT: String(API_PORT), WEB_ORIGIN: `http://localhost:${WEB_PORT}`, NODE_ENV: "test" },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm exec next dev --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/login`,
      env: { NEXT_PUBLIC_API_URL: `http://localhost:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
