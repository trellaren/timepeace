import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";
import { SUPABASE_ROOT_CA } from "./supabaseCa";

export * from "./generated/prisma/client";

export function createPrismaClient(connectionString = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({ adapter: new PrismaPg(poolConfig(connectionString)) });
}

/**
 * Supabase certificates chain to Supabase's own root CA, which isn't in Node's trust store.
 * For Supabase hosts, verify TLS (including the hostname) against that CA instead of relaxing checks.
 * sslmode in the URL is dropped there because node-postgres lets it override the `ssl` option.
 */
export function poolConfig(connectionString: string): { connectionString: string; ssl?: { ca: string; rejectUnauthorized: true } } {
  const url = new URL(connectionString);
  if (!/\.supabase\.(co|com)$/.test(url.hostname)) return { connectionString };
  for (const k of ["sslmode", "uselibpqcompat", "sslrootcert", "sslaccept"]) url.searchParams.delete(k);
  return { connectionString: url.toString(), ssl: { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true } };
}

/** Convert a YYYY-MM-DD local date to the Date Prisma expects for @db.Date columns. */
export function dbDate(localDate: string): Date {
  return new Date(`${localDate}T00:00:00.000Z`);
}

/** Inverse of dbDate. */
export function fromDbDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
