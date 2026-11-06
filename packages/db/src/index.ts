import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

export * from "./generated/prisma/client";

export function createPrismaClient(connectionString = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

/** Convert a YYYY-MM-DD local date to the Date Prisma expects for @db.Date columns. */
export function dbDate(localDate: string): Date {
  return new Date(`${localDate}T00:00:00.000Z`);
}

/** Inverse of dbDate. */
export function fromDbDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
