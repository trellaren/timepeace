import { describe, expect, it } from "vitest";
import { canManageRole, createInviteInput, invitableRoles, inviteStatus } from "../team";

describe("team permissions", () => {
  it("owners manage everyone; managers and HR only field workers; others nobody", () => {
    expect(invitableRoles("OWNER")).toEqual(["OWNER", "MANAGER", "WORKER", "HR", "ACCOUNTANT"]);
    expect(invitableRoles("MANAGER")).toEqual(["WORKER"]);
    expect(invitableRoles("HR")).toEqual(["WORKER"]);
    expect(invitableRoles("ACCOUNTANT")).toEqual([]);
    expect(invitableRoles("WORKER")).toEqual([]);
    expect(canManageRole("MANAGER", "MANAGER")).toBe(false);
    expect(canManageRole("HR", "OWNER")).toBe(false);
  });
});

describe("invite status", () => {
  const now = new Date("2026-11-06T12:00:00Z");
  const base = { acceptedAt: null, revokedAt: null, expiresAt: new Date("2026-11-10T00:00:00Z") };
  it("is pending, accepted, revoked or expired", () => {
    expect(inviteStatus(base, now)).toBe("PENDING");
    expect(inviteStatus({ ...base, acceptedAt: now }, now)).toBe("ACCEPTED");
    expect(inviteStatus({ ...base, revokedAt: now }, now)).toBe("REVOKED");
    expect(inviteStatus({ ...base, expiresAt: now }, now)).toBe("EXPIRED");
    // Accepted wins over a later expiry.
    expect(inviteStatus({ ...base, acceptedAt: now, expiresAt: new Date(0) }, now)).toBe("ACCEPTED");
  });
});

describe("invite input", () => {
  it("normalizes email and phone and requires a classification for workers", () => {
    const v = createInviteInput.parse({ email: " Jo@Example.COM ", name: "Jo", phone: "(303) 555-0142", role: "WORKER", classification: "W2" });
    expect(v.email).toBe("jo@example.com");
    expect(v.phone).toBe("3035550142");
    expect(createInviteInput.safeParse({ email: "a@b.co", name: "A", role: "WORKER" }).success).toBe(false);
    expect(createInviteInput.safeParse({ email: "a@b.co", name: "A", role: "MANAGER" }).success).toBe(true);
    expect(createInviteInput.safeParse({ email: "a@b.co", name: "A", role: "MANAGER", phone: "555" }).success).toBe(false);
  });
});
