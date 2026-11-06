import { execSync } from "node:child_process";
import path from "node:path";

export default function setup() {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error("Set E2E_DATABASE_URL to a disposable Postgres database (name ending in _test or _e2e)");
  const name = new URL(url).pathname.slice(1);
  if (!/_(test|e2e)$/.test(name)) throw new Error(`Refusing to seed "${name}": use a database whose name ends in _test or _e2e`);
  const cwd = path.resolve(import.meta.dirname, "../../../packages/db");
  const env = { ...process.env, DATABASE_URL: url };
  execSync("npx prisma migrate deploy", { cwd, env, stdio: "pipe" });
  execSync("npx tsx prisma/seed.ts", { cwd, env, stdio: "pipe" });
}
