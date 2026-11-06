import { execSync } from "node:child_process";
import path from "node:path";

/**
 * Integration tests run against TEST_DATABASE_URL, a disposable database whose name must end
 * in "_test". Pending migrations are applied and the demo seed (which clears all rows first)
 * is loaded fresh each run.
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("Set TEST_DATABASE_URL to a disposable Postgres database to run API tests");
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.endsWith("_test")) {
    throw new Error(`Refusing to run tests against "${dbName}": the test database name must end in _test`);
  }
  process.env.DATABASE_URL = url;
  const dbPkg = path.resolve(import.meta.dirname, "../../../packages/db");
  const run = (cmd: string) => execSync(cmd, { cwd: dbPkg, stdio: "pipe", env: { ...process.env, DATABASE_URL: url } });
  run("npx prisma migrate deploy");
  run("npx tsx prisma/seed.ts");
}
