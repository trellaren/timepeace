import { describe, expect, it } from "vitest";
import { db } from "../src/lib/db";
import { anon, callerFor, loginAs } from "./helpers";

const tokenOf = (url: string) => url.split("/invite/")[1]!;
const unique = (p: string) => `${p}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}@example.test`;

describe("team access", () => {
  it("is limited to owners, managers and HR; pay is visible to owners and HR only", async () => {
    for (const email of ["sam@acme.test", "accountant@acme.test"]) {
      const { caller } = await loginAs(email);
      await expect(caller.team.members()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const mgr = await loginAs("manager@acme.test");
    const asMgr = await mgr.caller.team.members();
    expect(asMgr.find((m) => m.email === "jake@acme.test")!.hourlyRateCents).toBeNull();
    const hr = await loginAs("hr@acme.test");
    expect((await hr.caller.team.members()).find((m) => m.email === "jake@acme.test")!.hourlyRateCents).toBeGreaterThan(0);
  });

  it("managers and HR can only invite field workers; only owners and HR set pay", async () => {
    const mgr = await loginAs("manager@acme.test");
    await expect(mgr.caller.team.invite({ email: unique("m"), name: "M", role: "MANAGER" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(mgr.caller.team.invite({ email: unique("w"), name: "W", role: "WORKER", classification: "W2", hourlyRateCents: 3000 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(mgr.caller.team.invite({ email: unique("w"), name: "W", role: "WORKER", classification: "W2" })).resolves.toMatchObject({ url: expect.stringContaining("/invite/") });
    const hr = await loginAs("hr@acme.test");
    await expect(hr.caller.team.invite({ email: unique("o"), name: "O", role: "OWNER" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(hr.caller.team.invite({ email: unique("w"), name: "W", role: "WORKER", classification: "W2", hourlyRateCents: 3000 })).resolves.toBeTruthy();
  });

  it("refuses to invite someone already on the team", async () => {
    const { caller } = await loginAs("owner@acme.test");
    await expect(caller.team.invite({ email: "jake@acme.test", name: "Jake", role: "WORKER", classification: "W2" })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("invite → accept", () => {
  it("creates the account, worker profile and starting pay, signs them in, and is single-use", async () => {
    const owner = await loginAs("owner@acme.test");
    const email = unique("newhire");
    const inv = await owner.caller.team.invite({ email, name: "New Hire", phone: "303-555-0199", role: "WORKER", classification: "CONTRACTOR_1099", hourlyRateCents: 3150 });
    const token = tokenOf(inv.url);

    const preview = await anon().invites.preview({ token });
    expect(preview).toMatchObject({ status: "PENDING", orgName: "Acme Homes", email, role: "WORKER", existingAccount: false });
    expect((await owner.caller.team.invites()).map((i) => i.email)).toContain(email);

    await expect(anon().invites.accept({ token, password: "short" })).rejects.toThrow(/10 characters/);
    const session = await anon().invites.accept({ token, password: "a-long-password", name: "Nina Hire" });
    expect(session).toMatchObject({ role: "WORKER", user: { email, name: "Nina Hire" }, org: { name: "Acme Homes" } });

    const me = await (await callerFor(session.token)).auth.me();
    expect(me.user.email).toBe(email);
    const member = (await owner.caller.team.members()).find((m) => m.email === email)!;
    expect(member).toMatchObject({ role: "WORKER", active: true, classification: "CONTRACTOR_1099", hourlyRateCents: 3150, phone: "3035550199" });

    // Single use: the link is dead and looks like any unknown link.
    await expect(anon().invites.accept({ token, password: "a-long-password" })).rejects.toThrow(/no longer valid/);
    expect(await anon().invites.preview({ token })).toEqual({ status: "INVALID" });
    expect((await owner.caller.team.invites()).map((i) => i.email)).not.toContain(email);

    // The raw token is never stored or audited.
    const row = await db().invite.findFirstOrThrow({ where: { email } });
    expect(row.tokenHash).not.toContain(token);
    const logs = await db().auditLog.findMany({ where: { entityId: row.id } });
    expect(logs.map((l) => l.action).sort()).toEqual(["accept", "create"]);
    expect(JSON.stringify(logs)).not.toContain(token);
  });

  it("someone with an existing account joins by proving their password; a wrong one doesn't use up the link", async () => {
    const other = await db().organization.create({
      data: { name: "Other Co", payPeriodAnchor: new Date("2026-01-04"), overtimeRules: {} },
    });
    const bcrypt = (await import("bcryptjs")).default;
    const email = unique("existing");
    const user = await db().user.create({ data: { email, name: "Exie Sting", passwordHash: await bcrypt.hash("their-own-password", 10) } });
    await db().membership.create({ data: { orgId: other.id, userId: user.id, role: "MANAGER" } });

    const owner = await loginAs("owner@acme.test");
    const token = tokenOf((await owner.caller.team.invite({ email, name: "Exie", role: "ACCOUNTANT" })).url);
    expect(await anon().invites.preview({ token })).toMatchObject({ status: "PENDING", existingAccount: true });

    await expect(anon().invites.accept({ token, password: "wrong-password-123" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(await anon().invites.preview({ token })).toMatchObject({ status: "PENDING" });

    const s = await anon().invites.accept({ token, password: "their-own-password", name: "Ignored" });
    expect(s).toMatchObject({ role: "ACCOUNTANT", org: { name: "Acme Homes" }, user: { name: "Exie Sting" } });
    const memberships = await db().membership.findMany({ where: { userId: user.id } });
    expect(memberships).toHaveLength(2);
  });

  it("regenerating kills the old link, revoking kills the link, expired links say so", async () => {
    const owner = await loginAs("owner@acme.test");
    const email = unique("regen");
    const inv = await owner.caller.team.invite({ email, name: "Re Gen", role: "WORKER", classification: "W2" });
    const regen = await owner.caller.team.regenerateInvite({ inviteId: inv.id });
    expect(await anon().invites.preview({ token: tokenOf(inv.url) })).toEqual({ status: "INVALID" });
    expect(await anon().invites.preview({ token: tokenOf(regen.url) })).toMatchObject({ status: "PENDING" });

    await owner.caller.team.revokeInvite({ inviteId: inv.id });
    expect(await anon().invites.preview({ token: tokenOf(regen.url) })).toEqual({ status: "INVALID" });

    const inv2 = await owner.caller.team.invite({ email: unique("exp"), name: "Ex Pired", role: "WORKER", classification: "W2" });
    await db().invite.update({ where: { id: inv2.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await anon().invites.preview({ token: tokenOf(inv2.url) })).toMatchObject({ status: "EXPIRED", orgName: "Acme Homes" });
    await expect(anon().invites.accept({ token: tokenOf(inv2.url), password: "a-long-password" })).rejects.toThrow(/no longer valid/);
  });

  it("re-inviting the same email replaces the pending invite", async () => {
    const owner = await loginAs("owner@acme.test");
    const email = unique("twice");
    const first = await owner.caller.team.invite({ email, name: "Twice", role: "WORKER", classification: "W2" });
    await owner.caller.team.invite({ email, name: "Twice", role: "WORKER", classification: "W2" });
    expect(await anon().invites.preview({ token: tokenOf(first.url) })).toEqual({ status: "INVALID" });
    expect((await owner.caller.team.invites()).filter((i) => i.email === email)).toHaveLength(1);
  });

  it("managers can't regenerate or revoke invites above their level", async () => {
    const owner = await loginAs("owner@acme.test");
    const inv = await owner.caller.team.invite({ email: unique("hrinv"), name: "H R", role: "HR" });
    const mgr = await loginAs("manager@acme.test");
    await expect(mgr.caller.team.regenerateInvite({ inviteId: inv.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(mgr.caller.team.revokeInvite({ inviteId: inv.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await mgr.caller.team.invites()).map((i) => i.id)).not.toContain(inv.id);
  });
});

describe("deactivate, reactivate, roles", () => {
  it("deactivating signs the person out and blocks login; reactivating restores access", async () => {
    const tyler = await loginAs("tyler@acme.test");
    const mgr = await loginAs("manager@acme.test");
    await mgr.caller.team.setActive({ userId: tyler.auth.userId, active: false });
    expect(await callerFor(tyler.token).then((c) => c.auth.me().catch((e) => e.code))).toBe("UNAUTHORIZED");
    await expect(loginAs("tyler@acme.test")).rejects.toThrow(/Invalid email or password/);
    expect((await mgr.caller.team.members()).find((m) => m.userId === tyler.auth.userId)!.active).toBe(false);

    await mgr.caller.team.setActive({ userId: tyler.auth.userId, active: true });
    await expect(loginAs("tyler@acme.test")).resolves.toBeTruthy();
  });

  it("managers can't deactivate staff; nobody can deactivate or re-role themselves", async () => {
    const mgr = await loginAs("manager@acme.test");
    const hr = await loginAs("hr@acme.test");
    await expect(mgr.caller.team.setActive({ userId: hr.auth.userId, active: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(mgr.caller.team.setActive({ userId: mgr.auth.userId, active: false })).rejects.toThrow(/yourself/);
    await expect(mgr.caller.team.setRole({ userId: hr.auth.userId, role: "WORKER" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const owner = await loginAs("owner@acme.test");
    await expect(owner.caller.team.setRole({ userId: owner.auth.userId, role: "MANAGER" })).rejects.toThrow(/another owner/);
  });

  it("owners change roles (audited); changing to worker creates a worker profile", async () => {
    const owner = await loginAs("owner@acme.test");
    const acct = await loginAs("accountant@acme.test");
    await owner.caller.team.setRole({ userId: acct.auth.userId, role: "WORKER" });
    expect(await db().workerProfile.count({ where: { userId: acct.auth.userId } })).toBe(1);
    expect((await owner.caller.team.members()).find((m) => m.userId === acct.auth.userId)!.role).toBe("WORKER");
    await owner.caller.team.setRole({ userId: acct.auth.userId, role: "ACCOUNTANT" });
    const logs = await db().auditLog.findMany({ where: { action: "role", actorId: owner.auth.userId } });
    expect(logs.length).toBeGreaterThanOrEqual(2);
  });

  it("pay rate changes are audited", async () => {
    const hr = await loginAs("hr@acme.test");
    const jake = (await hr.caller.team.members()).find((m) => m.email === "jake@acme.test")!;
    await hr.caller.org.setPayRate({ userId: jake.userId, classification: "W2", hourlyRateCents: 3400, burdenBps: 2500, effectiveDate: "2030-01-01" });
    const log = await db().auditLog.findFirst({ where: { action: "payRate" }, orderBy: { at: "desc" } });
    expect(log?.after).toMatchObject({ hourlyRateCents: 3400, effectiveDate: "2030-01-01" });
    await db().payRate.deleteMany({ where: { hourlyRateCents: 3400, effectiveDate: new Date("2030-01-01") } });
  });
});
