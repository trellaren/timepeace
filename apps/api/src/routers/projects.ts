import { dbDate } from "@timepeace/db";
import {
  createPhaseInput,
  createProjectInput,
  updateProjectInput,
  upsertBudgetLineInput,
} from "@timepeace/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { audit } from "../lib/audit";
import { db } from "../lib/db";
import { assertProjectAccess, projectScope } from "../services/access";
import { projectJobCost } from "../services/jobCost";
import { authedProcedure, financeProcedure, managerProcedure, router } from "../trpc";

type TemplatePhase = { name: string; tasks: { title: string; costCode?: string; estimatedMinutes?: number; estimatedMaterialCents?: number }[] };

export const projectsRouter = router({
  list: authedProcedure.query(async ({ ctx }) => {
    const projects = await db().project.findMany({
      where: projectScope(ctx.auth),
      include: { client: true, tasks: { select: { status: true } } },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    });
    return projects.map(({ tasks, ...p }) => ({
      ...p,
      taskCounts: {
        total: tasks.length,
        done: tasks.filter((t) => t.status === "DONE" || t.status === "VERIFIED").length,
        blocked: tasks.filter((t) => t.status === "BLOCKED" || t.status === "NEEDS_MATERIALS").length,
      },
    }));
  }),

  get: authedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    await assertProjectAccess(ctx.auth, input.id);
    return db().project.findUniqueOrThrow({
      where: { id: input.id },
      include: {
        client: true,
        phases: { orderBy: { sortOrder: "asc" } },
        tasks: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          include: {
            costCode: true,
            assignments: { include: { user: { select: { id: true, name: true } } } },
            materialRequests: { where: { status: { in: ["REQUESTED", "ORDERED"] } } },
          },
        },
        budgetLines: { include: { costCode: true }, orderBy: { costCode: { code: "asc" } } },
        changeOrders: { orderBy: { number: "asc" } },
      },
    });
  }),

  create: managerProcedure.input(createProjectInput).mutation(async ({ ctx, input }) => {
    return db().$transaction(async (tx) => {
      let clientId = input.clientId ?? null;
      if (!clientId && input.clientName) {
        clientId = (await tx.client.create({ data: { orgId: ctx.auth.orgId, name: input.clientName } })).id;
      }
      const project = await tx.project.create({
        data: {
          orgId: ctx.auth.orgId,
          clientId,
          name: input.name,
          address: input.address,
          projectType: input.projectType,
          contractType: input.contractType,
          contractValueCents: input.contractValueCents,
          markupBps: input.markupBps,
          startDate: input.startDate ? dbDate(input.startDate) : null,
          targetEndDate: input.targetEndDate ? dbDate(input.targetEndDate) : null,
        },
      });
      if (input.templateId) {
        const template = await tx.projectTemplate.findFirst({ where: { id: input.templateId, orgId: ctx.auth.orgId } });
        if (!template) throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
        const codes = await tx.costCode.findMany({ where: { orgId: ctx.auth.orgId } });
        const codeId = (c?: string) => codes.find((x) => x.code === c)?.id ?? null;
        if (!input.projectType && template.projectType) {
          await tx.project.update({ where: { id: project.id }, data: { projectType: template.projectType } });
        }
        for (const [pi, ph] of (template.phases as TemplatePhase[]).entries()) {
          const phase = await tx.phase.create({ data: { projectId: project.id, name: ph.name, sortOrder: pi } });
          await tx.task.createMany({
            data: ph.tasks.map((t, ti) => ({
              projectId: project.id,
              phaseId: phase.id,
              title: t.title,
              costCodeId: codeId(t.costCode),
              estimatedMinutes: t.estimatedMinutes ?? null,
              estimatedMaterialCents: t.estimatedMaterialCents ?? null,
              sortOrder: ti,
            })),
          });
        }
      }
      await audit(tx, { orgId: ctx.auth.orgId, actorId: ctx.auth.userId, entityType: "Project", entityId: project.id, action: "create", after: input });
      return project;
    });
  }),

  update: managerProcedure.input(updateProjectInput).mutation(async ({ ctx, input }) => {
    const { id, startDate, targetEndDate, clientName: _clientName, ...rest } = input;
    const before = await db().project.findFirst({ where: { id, orgId: ctx.auth.orgId } });
    if (!before) throw new TRPCError({ code: "NOT_FOUND" });
    return db().$transaction(async (tx) => {
      const p = await tx.project.update({
        where: { id },
        data: {
          ...rest,
          ...(startDate !== undefined ? { startDate: startDate ? dbDate(startDate) : null } : {}),
          ...(targetEndDate !== undefined ? { targetEndDate: targetEndDate ? dbDate(targetEndDate) : null } : {}),
        },
      });
      if (input.contractValueCents !== undefined && input.contractValueCents !== before.contractValueCents) {
        await audit(tx, { orgId: ctx.auth.orgId, actorId: ctx.auth.userId, entityType: "Project", entityId: id, action: "update.contractValue", before: before.contractValueCents, after: input.contractValueCents });
      }
      return p;
    });
  }),

  addPhase: managerProcedure.input(createPhaseInput).mutation(async ({ ctx, input }) => {
    await assertProjectAccess(ctx.auth, input.projectId);
    const max = await db().phase.aggregate({ where: { projectId: input.projectId }, _max: { sortOrder: true } });
    return db().phase.create({ data: { projectId: input.projectId, name: input.name, sortOrder: (max._max.sortOrder ?? -1) + 1 } });
  }),

  upsertBudgetLine: managerProcedure.input(upsertBudgetLineInput).mutation(async ({ ctx, input }) => {
    await assertProjectAccess(ctx.auth, input.projectId);
    return db().$transaction(async (tx) => {
      const key = { projectId_costCodeId_category: { projectId: input.projectId, costCodeId: input.costCodeId, category: input.category } };
      const before = await tx.budgetLine.findUnique({ where: key });
      const line = await tx.budgetLine.upsert({
        where: key,
        create: { projectId: input.projectId, costCodeId: input.costCodeId, category: input.category, amountCents: input.amountCents },
        update: { amountCents: input.amountCents },
      });
      await audit(tx, { orgId: ctx.auth.orgId, actorId: ctx.auth.userId, entityType: "BudgetLine", entityId: line.id, action: "upsert", before: before?.amountCents ?? null, after: input.amountCents });
      return line;
    });
  }),

  jobCost: financeProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    await assertProjectAccess(ctx.auth, input.id);
    return projectJobCost(db(), ctx.auth.orgId, input.id);
  }),
});
