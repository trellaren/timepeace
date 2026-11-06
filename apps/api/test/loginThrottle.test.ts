import bcrypt from "bcryptjs";
import { afterEach, describe, expect, it } from "vitest";
import { clientIp } from "../src/context";
import { db } from "../src/lib/db";
import { LOGIN_LIMITS } from "../src/services/loginThrottle";
import { anonFrom, loginAs } from "./helpers";

const PW = "correct-horse-battery";
let n = 0;
const ip = () => `10.${++n}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

async function newMember(): Promise<string> {
  const email = `throttle.${Date.now()}.${++n}@example.test`;
  const org = await db().organization.findFirstOrThrow({ where: { name: "Acme Homes" } });
  const user = await db().user.create({ data: { email, name: "Throttle Test", passwordHash: await bcrypt.hash(PW, 4) } });
  await db().membership.create({ data: { orgId: org.id, userId: user.id, role: "WORKER" } });
  return email;
}

const fail = (from: string, email: string) => anonFrom(from).auth.login({ email, password: "wrong-password" });
async function failTimes(from: string, email: string, times: number) {
  for (let i = 0; i < times; i++) await expect(fail(from, email)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
}

afterEach(() => {
  delete process.env.VERCEL;
});

describe("sign-in rate limiting", () => {
  it(`locks an email after ${LOGIN_LIMITS.emailFailures} failures, even for the right password; other accounts on the same IP are fine`, async () => {
    const email = await newMember();
    const other = await newMember();
    const from = ip();
    await failTimes(from, email, LOGIN_LIMITS.emailFailures);
    await expect(anonFrom(from).auth.login({ email, password: PW })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS", message: expect.stringMatching(/Try again in about 15 minutes/) });
    // Locked from any IP: it's the account being protected.
    await expect(anonFrom(ip()).auth.login({ email, password: PW })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    await expect(anonFrom(from).auth.login({ email: other, password: PW })).resolves.toMatchObject({ user: { email: other } });
  });

  it("treats unknown emails the same, so a lockout doesn't reveal which accounts exist", async () => {
    const ghost = `ghost.${Date.now()}@example.test`;
    const from = ip();
    await failTimes(from, ghost, LOGIN_LIMITS.emailFailures);
    await expect(fail(from, ghost)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("a successful sign-in clears the email's count", async () => {
    const email = await newMember();
    const from = ip();
    await failTimes(from, email, LOGIN_LIMITS.emailFailures - 1);
    await anonFrom(from).auth.login({ email, password: PW });
    await failTimes(from, email, LOGIN_LIMITS.emailFailures - 1);
    await expect(anonFrom(from).auth.login({ email, password: PW })).resolves.toBeTruthy();
  });

  it("the lock lifts when it expires, and an old window starts counting again", async () => {
    const email = await newMember();
    const from = ip();
    await failTimes(from, email, LOGIN_LIMITS.emailFailures);
    await expect(anonFrom(from).auth.login({ email, password: PW })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    const past = new Date(Date.now() - 16 * 60_000);
    await db().loginThrottle.updateMany({ where: { key: { startsWith: "email:" } , lockedUntil: { not: null } }, data: { lockedUntil: past, windowStart: past } });
    await expect(fail(from, email)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anonFrom(from).auth.login({ email, password: PW })).resolves.toBeTruthy();
  });

  it(`blocks an IP after ${LOGIN_LIMITS.ipFailures} failures across many accounts; success doesn't reset the IP`, async () => {
    const email = await newMember();
    const from = ip();
    for (let i = 0; i < LOGIN_LIMITS.ipFailures - 1; i++) await expect(fail(from, `spray${i}.${Date.now()}@example.test`)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await anonFrom(from).auth.login({ email, password: PW }); // a valid login doesn't reset the IP count
    await expect(fail(from, `spray-last.${Date.now()}@example.test`)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anonFrom(from).auth.login({ email, password: PW })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    await expect(anonFrom(ip()).auth.login({ email, password: PW })).resolves.toBeTruthy();
  });

  it("a right password for a deactivated account isn't counted as a guess", async () => {
    const email = await newMember();
    await db().membership.updateMany({ where: { user: { email } }, data: { active: false } });
    const from = ip();
    for (let i = 0; i < LOGIN_LIMITS.emailFailures + 2; i++) {
      await expect(anonFrom(from).auth.login({ email, password: PW })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
  });

  it("joining with an existing account through an invite shares the same limits", async () => {
    const other = await db().organization.create({ data: { name: `Other ${Date.now()}`, payPeriodAnchor: new Date("2026-01-04"), overtimeRules: {} } });
    const email = `invitee.${Date.now()}@example.test`;
    const user = await db().user.create({ data: { email, name: "Inv Itee", passwordHash: await bcrypt.hash(PW, 4) } });
    await db().membership.create({ data: { orgId: other.id, userId: user.id, role: "MANAGER" } });
    const owner = await loginAs("owner@acme.test");
    const token = (await owner.caller.team.invite({ email, name: "Inv Itee", role: "ACCOUNTANT" })).url.split("/invite/")[1]!;

    const from = ip();
    for (let i = 0; i < LOGIN_LIMITS.emailFailures; i++) {
      await expect(anonFrom(from).invites.accept({ token, password: "wrong-password" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
    await expect(anonFrom(from).invites.accept({ token, password: PW })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    await expect(anonFrom(from).auth.login({ email, password: PW })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(await anonFrom(from).invites.preview({ token })).toMatchObject({ status: "PENDING" });
  });

  it("stores emails hashed", async () => {
    const ghost = `hashed.${Date.now()}@example.test`;
    await expect(fail(ip(), ghost)).rejects.toBeTruthy();
    const rows = await db().loginThrottle.findMany();
    expect(JSON.stringify(rows)).not.toContain(ghost);
  });
});

describe("client IP", () => {
  const req = (headers: Record<string, string>) => ({ headers, ip: "203.0.113.9" }) as never;
  it("ignores forwarding headers unless running on Vercel (where the proxy overwrites them)", () => {
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4" }))).toBe("203.0.113.9");
    process.env.VERCEL = "1";
    expect(clientIp(req({ "x-vercel-forwarded-for": "198.51.100.7", "x-forwarded-for": "1.2.3.4" }))).toBe("198.51.100.7");
    expect(clientIp(req({ "x-real-ip": "198.51.100.8" }))).toBe("198.51.100.8");
    expect(clientIp(req({}))).toBe("203.0.113.9");
  });
});
