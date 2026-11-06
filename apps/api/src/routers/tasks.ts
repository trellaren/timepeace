import { dbDate } from "@timepeace/db";
import { assignTaskInput, createTaskInput, updateTaskInput } from "@timepeace/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { db } from "../lib/db";
import { assertProjectAccess, assertTaskAccess } from "../services/access";
import { setTaskStatus } from "../services/sync";
import { managerProcedure, router } from "../trpc";

export const tasksRouter = router({
  create: managerProcedure.input(createTaskInput).mutation(async ({ ctx, input }) => {
    await assertProjectAccess(ctx.auth, input.projectId);
    const max = await db().task.aggregate({ where: { projectId: input.projectId, phaseId: input.phaseId ?? null }, _max: { sortOrder: true } });
    return db().task.create({ data: { ...input, sortOrder: (max._max.sortOrder ?? -1) + 1 } });
  }),

  update: managerProcedure.input(updateTaskInput).mutation(async ({ ctx, input }) => {
    const { id, status, ...rest } = input;
    const task = await assertTaskAccess(ctx.auth, id);
    return db().$transaction(async (tx) => {
      if (status && status !== task.status) await setTaskStatus(tx, ctx.auth, task, status, null, new Date());
      return tx.task.update({ where: { id }, data: rest });
    });
  }),

  delete: managerProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    await assertTaskAccess(ctx.auth, input.id);
    const hasTime = await db().timeEntry.count({ where: { taskId: input.id } });
    if (hasTime) throw new TRPCError({ code: "CONFLICT", message: "Task has recorded time; mark it cancelled/done instead" });
    await db().task.delete({ where: { id: input.id } });
    return { ok: true };
  }),

  assign: managerProcedure.input(assignTaskInput).mutation(async ({ ctx, input }) => {
    await assertTaskAccess(ctx.auth, input.taskId);
    const member = await db().membership.findUnique({ where: { orgId_userId: { orgId: ctx.auth.orgId, userId: input.userId } } });
    if (!member?.active) throw new TRPCError({ code: "BAD_REQUEST", message: "User is not an active member" });
    const date = input.scheduledDate ? dbDate(input.scheduledDate) : null;
    return db().taskAssignment.upsert({
      where: { taskId_userId: { taskId: input.taskId, userId: input.userId } },
      create: { taskId: input.taskId, userId: input.userId, scheduledStart: date, scheduledEnd: date },
      update: { scheduledStart: date, scheduledEnd: date },
    });
  }),

  unassign: managerProcedure.input(z.object({ taskId: z.string(), userId: z.string() })).mutation(async ({ ctx, input }) => {
    await assertTaskAccess(ctx.auth, input.taskId);
    await db().taskAssignment.deleteMany({ where: { taskId: input.taskId, userId: input.userId } });
    return { ok: true };
  }),

  /** Simple schedule: assignments in a date window, grouped client-side by worker or project. */
  schedule: managerProcedure.input(z.object({ from: z.iso.date(), to: z.iso.date() })).query(async ({ ctx, input }) =>
    db().taskAssignment.findMany({
      where: {
        task: { project: { orgId: ctx.auth.orgId } },
        OR: [{ scheduledStart: null }, { scheduledStart: { lte: dbDate(input.to) }, OR: [{ scheduledEnd: null }, { scheduledEnd: { gte: dbDate(input.from) } }] }],
      },
      include: { user: { select: { id: true, name: true } }, task: { include: { project: { select: { id: true, name: true } } } } },
    }),
  ),
});
