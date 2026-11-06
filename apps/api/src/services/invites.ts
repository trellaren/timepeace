import { dbDate } from "@timepeace/db";
import { INVITE_TTL_DAYS, canManageRole, inviteStatus, toLocalDate, type Role, type WorkerClassification } from "@timepeace/shared";
import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { env } from "../env";
import { audit } from "../lib/audit";
import { hashToken } from "../lib/crypto";
import type { Tx } from "../lib/db";
import { startSession } from "./session";

export interface Actor {
  userId: string;
  orgId: string;
  role: Role;
}

const newInviteToken = () => randomBytes(32).toString("base64url");
export const inviteUrl = (token: string) => `${env.appUrl}/invite/${token}`;
const expiry = () => new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);

export interface CreateInvite {
  email: string;
  name: string;
  phone?: string | null;
  role: Role;
  classification?: WorkerClassification | null;
  hourlyRateCents?: number | null;
}

export async function createInvite(tx: Tx, actor: Actor, input: CreateInvite) {
  if (!canManageRole(actor.role, input.role)) throw new TRPCError({ code: "FORBIDDEN", message: "You can't invite someone with that role" });
  if (input.hourlyRateCents != null && !["OWNER", "HR"].includes(actor.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only owners and HR can set pay rates" });
  }

  const existing = await tx.user.findUnique({ where: { email: input.email }, include: { memberships: { where: { orgId: actor.orgId } } } });
  const membership = existing?.memberships[0];
  if (membership?.active) throw new TRPCError({ code: "CONFLICT", message: `${existing!.name} is already on the team` });
  if (membership && !membership.active) {
    throw new TRPCError({ code: "CONFLICT", message: `${existing!.name} was deactivated. Reactivate them from the team list instead.` });
  }

  // One live invite per email: replace any pending one.
  await tx.invite.updateMany({
    where: { orgId: actor.orgId, email: input.email, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  const token = newInviteToken();
  const invite = await tx.invite.create({
    data: {
      orgId: actor.orgId,
      email: input.email,
      name: input.name,
      phone: input.phone ?? null,
      role: input.role,
      classification: input.role === "WORKER" ? (input.classification ?? "W2") : null,
      hourlyRateCents: input.hourlyRateCents ?? null,
      tokenHash: hashToken(token),
      invitedById: actor.userId,
      expiresAt: expiry(),
    },
  });
  await audit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    entityType: "Invite",
    entityId: invite.id,
    action: "create",
    after: { email: invite.email, role: invite.role, classification: invite.classification, hourlyRateSet: invite.hourlyRateCents != null },
  });
  return { invite, url: inviteUrl(token) };
}

async function manageableInvite(tx: Tx, actor: Actor, inviteId: string) {
  const invite = await tx.invite.findFirst({ where: { id: inviteId, orgId: actor.orgId } });
  if (!invite) throw new TRPCError({ code: "NOT_FOUND" });
  if (!canManageRole(actor.role, invite.role)) throw new TRPCError({ code: "FORBIDDEN" });
  return invite;
}

/** New link and a fresh expiry. The old link stops working. */
export async function regenerateInvite(tx: Tx, actor: Actor, inviteId: string) {
  const invite = await manageableInvite(tx, actor, inviteId);
  if (invite.acceptedAt) throw new TRPCError({ code: "CONFLICT", message: "This invite was already accepted" });
  const token = newInviteToken();
  await tx.invite.update({ where: { id: invite.id }, data: { tokenHash: hashToken(token), expiresAt: expiry(), revokedAt: null } });
  await audit(tx, { orgId: actor.orgId, actorId: actor.userId, entityType: "Invite", entityId: invite.id, action: "regenerate" });
  return { url: inviteUrl(token) };
}

export async function revokeInvite(tx: Tx, actor: Actor, inviteId: string) {
  const invite = await manageableInvite(tx, actor, inviteId);
  if (invite.acceptedAt) throw new TRPCError({ code: "CONFLICT", message: "This invite was already accepted" });
  await tx.invite.update({ where: { id: invite.id }, data: { revokedAt: new Date() } });
  await audit(tx, { orgId: actor.orgId, actorId: actor.userId, entityType: "Invite", entityId: invite.id, action: "revoke" });
  return { ok: true };
}

async function findByToken(tx: Tx, token: string) {
  return tx.invite.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { org: { select: { id: true, name: true, timezone: true } }, invitedBy: { select: { name: true } } },
  });
}

/** Public: what the accept page shows. Unknown and used links look the same, so tokens can't be probed. */
export async function previewInvite(tx: Tx, token: string) {
  const invite = await findByToken(tx, token);
  const status = invite ? inviteStatus(invite) : null;
  if (!invite || status === "ACCEPTED" || status === "REVOKED") return { status: "INVALID" as const };
  if (status === "EXPIRED") return { status: "EXPIRED" as const, orgName: invite.org.name, inviterName: invite.invitedBy.name };
  const existingAccount = (await tx.user.count({ where: { email: invite.email } })) > 0;
  return {
    status: "PENDING" as const,
    orgName: invite.org.name,
    inviterName: invite.invitedBy.name,
    name: invite.name,
    email: invite.email,
    role: invite.role,
    existingAccount,
  };
}

const invalid = () => new TRPCError({ code: "BAD_REQUEST", message: "This invite link is no longer valid. Ask for a new one." });

/**
 * Accepts an invite and signs the person in. New people choose a password (name optional);
 * someone who already has an account (e.g. at another company) proves it with their password.
 */
export async function acceptInvite(tx: Tx, input: { token: string; password: string; name?: string }) {
  const invite = await findByToken(tx, input.token);
  if (!invite || inviteStatus(invite) !== "PENDING") throw invalid();

  // Claim the invite first so two concurrent accepts can't both succeed.
  const claimed = await tx.invite.updateMany({
    where: { id: invite.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { acceptedAt: new Date() },
  });
  if (claimed.count !== 1) throw invalid();

  let user = await tx.user.findUnique({ where: { email: invite.email } });
  if (user) {
    if (!(await bcrypt.compare(input.password, user.passwordHash))) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "That isn't the password for this account" });
    }
  } else {
    if (input.password.length < 10) throw new TRPCError({ code: "BAD_REQUEST", message: "Use at least 10 characters for your password" });
    user = await tx.user.create({
      data: { email: invite.email, name: input.name?.trim() || invite.name, phone: invite.phone, passwordHash: await bcrypt.hash(input.password, 10) },
    });
  }

  const membership = await tx.membership.upsert({
    where: { orgId_userId: { orgId: invite.orgId, userId: user.id } },
    create: { orgId: invite.orgId, userId: user.id, role: invite.role },
    update: { role: invite.role, active: true },
  });

  if (invite.role === "WORKER") {
    const profile = await tx.workerProfile.upsert({
      where: { orgId_userId: { orgId: invite.orgId, userId: user.id } },
      create: { orgId: invite.orgId, userId: user.id, classification: invite.classification ?? "W2" },
      update: { classification: invite.classification ?? "W2" },
    });
    if (invite.hourlyRateCents != null) {
      const effectiveDate = dbDate(toLocalDate(new Date(), invite.org.timezone));
      await tx.payRate.upsert({
        where: { workerProfileId_effectiveDate: { workerProfileId: profile.id, effectiveDate } },
        create: { workerProfileId: profile.id, hourlyRateCents: invite.hourlyRateCents, effectiveDate },
        update: { hourlyRateCents: invite.hourlyRateCents },
      });
    }
  }

  await tx.invite.update({ where: { id: invite.id }, data: { acceptedUserId: user.id } });
  await audit(tx, { orgId: invite.orgId, actorId: user.id, entityType: "Invite", entityId: invite.id, action: "accept", after: { role: membership.role } });
  return startSession(tx, user, { role: membership.role, org: invite.org });
}

/** Email on a live invite (for rate limiting the existing-account password check), or null. */
export async function inviteEmail(tx: Tx, token: string): Promise<string | null> {
  const invite = await findByToken(tx, token);
  return invite && inviteStatus(invite) === "PENDING" ? invite.email : null;
}
