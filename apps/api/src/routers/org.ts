import { dbDate } from "@timepeace/db";
import { workerProfileInput } from "@timepeace/shared";
import { TRPCError } from "@trpc/server";
import { db } from "../lib/db";
import { authedProcedure, managerProcedure, roleProcedure, router } from "../trpc";

export const orgRouter = router({
  /** Members (managers/HR see everyone with pay data restricted to HR/Owner). */
  members: roleProcedure(["OWNER", "MANAGER", "HR", "ACCOUNTANT"]).query(async ({ ctx }) => {
    const seePay = ["OWNER", "HR"].includes(ctx.auth.role);
    const members = await db().membership.findMany({
      where: { orgId: ctx.auth.orgId, active: true },
      include: {
        user: {
          include: {
            workerProfiles: { where: { orgId: ctx.auth.orgId }, include: { payRates: { orderBy: { effectiveDate: "desc" }, take: 1 } } },
          },
        },
      },
      orderBy: { user: { name: "asc" } },
    });
    return members.map((m) => {
      const wp = m.user.workerProfiles[0];
      return {
        userId: m.userId,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
        classification: wp?.classification ?? null,
        hourlyRateCents: seePay ? (wp?.payRates[0]?.hourlyRateCents ?? null) : null,
      };
    });
  }),

  workers: managerProcedure.query(async ({ ctx }) => {
    const members = await db().membership.findMany({
      where: { orgId: ctx.auth.orgId, active: true, role: "WORKER" },
      include: { user: true },
      orderBy: { user: { name: "asc" } },
    });
    return members.map((m) => ({ id: m.userId, name: m.user.name }));
  }),

  costCodes: authedProcedure.query(({ ctx }) =>
    db().costCode.findMany({ where: { orgId: ctx.auth.orgId }, orderBy: { code: "asc" } }),
  ),

  templates: managerProcedure.query(({ ctx }) =>
    db().projectTemplate.findMany({ where: { orgId: ctx.auth.orgId }, select: { id: true, name: true, projectType: true }, orderBy: { name: "asc" } }),
  ),

  clients: managerProcedure.query(({ ctx }) =>
    db().client.findMany({ where: { orgId: ctx.auth.orgId }, orderBy: { name: "asc" } }),
  ),

  setPayRate: roleProcedure(["OWNER", "HR"]).input(workerProfileInput).mutation(async ({ ctx, input }) => {
    const m = await db().membership.findUnique({ where: { orgId_userId: { orgId: ctx.auth.orgId, userId: input.userId } } });
    if (!m) throw new TRPCError({ code: "NOT_FOUND" });
    return db().$transaction(async (tx) => {
      const wp = await tx.workerProfile.upsert({
        where: { orgId_userId: { orgId: ctx.auth.orgId, userId: input.userId } },
        create: { orgId: ctx.auth.orgId, userId: input.userId, classification: input.classification, burdenBps: input.burdenBps },
        update: { classification: input.classification, burdenBps: input.burdenBps },
      });
      await tx.payRate.upsert({
        where: { workerProfileId_effectiveDate: { workerProfileId: wp.id, effectiveDate: dbDate(input.effectiveDate) } },
        create: { workerProfileId: wp.id, effectiveDate: dbDate(input.effectiveDate), hourlyRateCents: input.hourlyRateCents },
        update: { hourlyRateCents: input.hourlyRateCents },
      });
      return { ok: true };
    });
  }),
});
