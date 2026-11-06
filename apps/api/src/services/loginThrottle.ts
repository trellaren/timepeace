import { TRPCError } from "@trpc/server";
import { createHash } from "node:crypto";
import type { Tx } from "../lib/db";

/**
 * Failed sign-in limits, kept in Postgres because serverless instances don't share memory.
 * - per email: stops guessing one person's password
 * - per IP: stops one source spraying many accounts
 * Blocked requests are refused before the password is checked, the same way whether or not the
 * account exists. Emails are stored hashed.
 */
export const LOGIN_LIMITS = {
  windowMinutes: 15,
  lockMinutes: 15,
  emailFailures: 8,
  ipFailures: 40,
};

const emailKey = (email: string) => `email:${createHash("sha256").update(email.trim().toLowerCase()).digest("hex")}`;
const ipKey = (ip: string) => `ip:${ip}`;

function tooMany(until: Date) {
  const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
  return new TRPCError({ code: "TOO_MANY_REQUESTS", message: `Too many sign-in attempts. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.` });
}

/** Throws TOO_MANY_REQUESTS if this email or IP is currently locked. */
export async function assertLoginAllowed(tx: Tx, email: string, ip: string) {
  const rows = await tx.loginThrottle.findMany({ where: { key: { in: [emailKey(email), ipKey(ip)] }, lockedUntil: { gt: new Date() } } });
  if (rows.length) throw tooMany(new Date(Math.max(...rows.map((r) => r.lockedUntil!.getTime()))));
}

async function bump(tx: Tx, key: string, limit: number) {
  const { windowMinutes, lockMinutes } = LOGIN_LIMITS;
  // One atomic statement so concurrent failures can't undercount. Prisma stores these columns as
  // UTC `timestamp` (no time zone), so use UTC explicitly rather than the session's zone.
  await tx.$executeRaw`
    INSERT INTO "LoginThrottle" ("key", "failures", "windowStart", "lockedUntil", "updatedAt")
    VALUES (${key}, 1, (now() AT TIME ZONE 'UTC'), CASE WHEN 1 >= ${limit} THEN (now() AT TIME ZONE 'UTC') + make_interval(mins => ${lockMinutes}) END, (now() AT TIME ZONE 'UTC'))
    ON CONFLICT ("key") DO UPDATE SET
      "failures"    = CASE WHEN "LoginThrottle"."windowStart" < (now() AT TIME ZONE 'UTC') - make_interval(mins => ${windowMinutes}) THEN 1 ELSE "LoginThrottle"."failures" + 1 END,
      "windowStart" = CASE WHEN "LoginThrottle"."windowStart" < (now() AT TIME ZONE 'UTC') - make_interval(mins => ${windowMinutes}) THEN (now() AT TIME ZONE 'UTC') ELSE "LoginThrottle"."windowStart" END,
      "lockedUntil" = CASE
        WHEN (CASE WHEN "LoginThrottle"."windowStart" < (now() AT TIME ZONE 'UTC') - make_interval(mins => ${windowMinutes}) THEN 1 ELSE "LoginThrottle"."failures" + 1 END) >= ${limit}
          THEN (now() AT TIME ZONE 'UTC') + make_interval(mins => ${lockMinutes})
        ELSE "LoginThrottle"."lockedUntil"
      END,
      "updatedAt"   = (now() AT TIME ZONE 'UTC')`;
}

/** Count a failed password for this email and IP. */
export async function recordLoginFailure(tx: Tx, email: string, ip: string) {
  await bump(tx, emailKey(email), LOGIN_LIMITS.emailFailures);
  await bump(tx, ipKey(ip), LOGIN_LIMITS.ipFailures);
  // Housekeeping: drop counters nobody has touched for a day (cheap, indexed).
  if (Math.random() < 0.05) await tx.loginThrottle.deleteMany({ where: { updatedAt: { lt: new Date(Date.now() - 86_400_000) } } });
}

/**
 * A correct password clears that email's counter. The IP counter is left alone, otherwise anyone
 * with one valid account could reset it between guesses at other accounts.
 */
export async function recordLoginSuccess(tx: Tx, email: string) {
  await tx.loginThrottle.deleteMany({ where: { key: emailKey(email) } });
}
