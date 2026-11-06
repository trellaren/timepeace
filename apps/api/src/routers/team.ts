import { fromDbDate } from "@timepeace/db";
import { PAY_ROLES, ROLES, TEAM_ROLES, canManageRole, createInviteInput, inviteStatus } from "@timepeace/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { audit } from "../lib/audit";
import { db, type Tx } from "../lib/db";
import { createInvite, regenerateInvite, revokeInvite } from "../services/invites";
import { roleProcedure, router } from "../trpc";

const teamProcedure = roleProcedure(TEAM_ROLES);

export const teamRouter = router({
  /** Everyone in the org, including deactivated people. Pay is visible to owners and HR only. */
  members: teamProcedure.query(async ({ ctx }) => {
    const seePay = PAY_ROLES.includes(ctx.auth.role);
    const rows = await db().membership.findMany({
      where: { orgId: ctx.auth.orgId },
      include: {
        user: {
          include: {
            workerProfiles: { where: { orgId: ctx.auth.orgId }, include: { payRates: { orderBy: { effectiveDate: "desc" }, take: 1 } } },
            sessions: { where: { orgId: ctx.auth.orgId }, orderBy: { lastUsedAt: "desc" }, take: 1, select: { lastUsedAt: true } },
          },
        },
      },
      orderBy: [{ active: "desc" }, { user: { name: "asc" } }],
    });
    return rows.map((m) => {
      const wp = m.user.workerProfiles[0];
      const rate = wp?.payRates[0];
      return {
        userId: m.userId,
        name: m.user.name,
        email: m.user.email,
        phone: m.user.phone,
        role: m.role,
        active: m.active,
        isYou: m.userId === ctx.auth.userId,
        canManage: m.userId !== ctx.auth.userId && canManageRole(ctx.auth.role, m.role),
        lastActiveAt: m.user.sessions[0]?.lastUsedAt ?? null,
        classification: wp?.classification ?? null,
        burdenBps: seePay ? (wp?.burdenBps ?? null) : null,
        hourlyRateCents: seePay ? (rate?.hourlyRateCents ?? null) : null,
        rateEffectiveDate: seePay && rate ? fromDbDate(rate.effectiveDate) : null,
      };
    });
  }),

  invites: teamProcedure.query(async ({ ctx }) => {
    const rows = await db().invite.findMany({
      where: { orgId: ctx.auth.orgId, acceptedAt: null, revokedAt: null },
      include: { invitedBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return rows
      .filter((i) => canManageRole(ctx.auth.role, i.role))
      .map((i) => ({
        id: i.id,
        email: i.email,
        name: i.name,
        phone: i.phone,
        role: i.role,
        classification: i.classification,
        status: inviteStatus(i),
        expiresAt: i.expiresAt,
        createdAt: i.createdAt,
        invitedBy: i.invitedBy.name,
      }));
  }),

  /** Returns the link once; only its hash is stored. */
  invite: teamProcedure.input(createInviteInput).mutation(async ({ ctx, input }) => {
    const { invite, url } = await db().$transaction((tx) => createInvite(tx, ctx.auth, input));
    const org = await db().organization.findUniqueOrThrow({ where: { id: ctx.auth.orgId }, select: { name: true } });
    return { id: invite.id, url, orgName: org.name, inviterName: ctx.auth.name };
  }),

  regenerateInvite: teamProcedure.input(z.object({ inviteId: z.string() })).mutation(async ({ ctx, input }) => {
    const { url } = await db().$transaction((tx) => regenerateInvite(tx, ctx.auth, input.inviteId));
    const org = await db().organization.findUniqueOrThrow({ where: { id: ctx.auth.orgId }, select: { name: true } });
    return { url, orgName: org.name, inviterName: ctx.auth.name };
  }),

  revokeInvite: teamProcedure.input(z.object({ inviteId: z.string() })).mutation(({ ctx, input }) => db().$transaction((tx) => revokeInvite(tx, ctx.auth, input.inviteId))),

  /** Deactivating signs the person out everywhere in this org; their history stays. */
  setActive: teamProcedure.input(z.object({ userId: z.string(), active: z.boolean() })).mutation(async ({ ctx, input }) => {
    if (input.userId === ctx.auth.userId) throw new TRPCError({ code: "BAD_REQUEST", message: "You can't deactivate yourself" });
    return db().$transaction(async (tx) => {
      const m = await tx.membership.findUnique({ where: { orgId_userId: { orgId: ctx.auth.orgId, userId: input.userId } } });
      if (!m) throw new TRPCError({ code: "NOT_FOUND" });
      if (!canManageRole(ctx.auth.role, m.role)) throw new TRPCError({ code: "FORBIDDEN" });
      if (m.active === input.active) return { ok: true };
      if (!input.active && m.role === "OWNER") await assertAnotherOwner(tx, ctx.auth.orgId, m.userId);
      await tx.membership.update({ where: { id: m.id }, data: { active: input.active } });
      if (!input.active) await tx.session.deleteMany({ where: { userId: m.userId, orgId: ctx.auth.orgId } });
      await audit(tx, { orgId: ctx.auth.orgId, actorId: ctx.auth.userId, entityType: "Membership", entityId: m.id, action: input.active ? "reactivate" : "deactivate" });
      return { ok: true };
    });
  }),

  /** Owners only. Keeps at least one active owner. */
  setRole: roleProcedure(["OWNER"])
    .input(z.object({ userId: z.string(), role: z.enum(ROLES) }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.auth.userId) throw new TRPCError({ code: "BAD_REQUEST", message: "Ask another owner to change your role" });
      return db().$transaction(async (tx) => {
        const m = await tx.membership.findUnique({ where: { orgId_userId: { orgId: ctx.auth.orgId, userId: input.userId } } });
        if (!m) throw new TRPCError({ code: "NOT_FOUND" });
        if (m.role === input.role) return { ok: true };
        if (m.role === "OWNER") await assertAnotherOwner(tx, ctx.auth.orgId, m.userId);
        await tx.membership.update({ where: { id: m.id }, data: { role: input.role } });
        if (input.role === "WORKER") {
          await tx.workerProfile.upsert({
            where: { orgId_userId: { orgId: ctx.auth.orgId, userId: m.userId } },
            create: { orgId: ctx.auth.orgId, userId: m.userId },
            update: {},
          });
        }
        await audit(tx, { orgId: ctx.auth.orgId, actorId: ctx.auth.userId, entityType: "Membership", entityId: m.id, action: "role", before: { role: m.role }, after: { role: input.role } });
        return { ok: true };
      });
    }),
});

async function assertAnotherOwner(tx: Tx, orgId: string, exceptUserId: string) {
  const others = await tx.membership.count({ where: { orgId, role: "OWNER", active: true, userId: { not: exceptUserId } } });
  if (!others) throw new TRPCError({ code: "BAD_REQUEST", message: "The company needs at least one active owner" });
}
