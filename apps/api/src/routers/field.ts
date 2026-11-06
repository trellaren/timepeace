import { dbDate, fromDbDate } from "@timepeace/db";
import { DEFAULT_MIN_UNPAID_BREAK_MINUTES, addDays, localRangeToUtc, paidShiftMinutes, syncPushInput, toLocalDate } from "@timepeace/shared";
import { z } from "zod";
import { db } from "../lib/db";
import { getOrCreatePayPeriod, overtimeRules } from "../services/org";
import { applyOps } from "../services/sync";
import { computeTotals, submitTimesheet } from "../services/timesheet";
import { authedProcedure, router } from "../trpc";

/** Endpoints used by the mobile app for the signed-in worker. */
export const fieldRouter = router({
  /** Today's work: assigned open tasks (scheduled today or unscheduled), running timer, today's entries. */
  myDay: authedProcedure.query(async ({ ctx }) => {
    const org = await db().organization.findUniqueOrThrow({ where: { id: ctx.auth.orgId } });
    const today = toLocalDate(new Date(), org.timezone);
    const todayDb = dbDate(today);
    const assignments = await db().taskAssignment.findMany({
      where: {
        userId: ctx.auth.userId,
        task: { project: { orgId: org.id, status: { in: ["ACTIVE", "PLANNING"] } }, status: { not: "VERIFIED" } },
        OR: [
          { scheduledStart: null },
          { scheduledStart: { lte: todayDb }, OR: [{ scheduledEnd: null }, { scheduledEnd: { gte: todayDb } }] },
        ],
      },
      include: {
        task: {
          include: {
            project: { select: { id: true, name: true, address: true } },
            phase: { select: { name: true } },
            materialRequests: { where: { status: { in: ["REQUESTED", "ORDERED"] } }, select: { id: true, description: true, quantity: true, status: true } },
          },
        },
      },
    });
    const dayRange = localRangeToUtc(today, today, org.timezone);
    const entries = await db().timeEntry.findMany({
      where: { userId: ctx.auth.userId, OR: [{ startedAt: dayRange }, { endedAt: null }] },
      orderBy: { startedAt: "asc" },
      include: { task: { select: { title: true } } },
    });
    const running = entries.find((e) => !e.endedAt) ?? null;
    const openShift = await db().shift.findFirst({
      where: { userId: ctx.auth.userId, clockOutAt: null },
      orderBy: { clockInAt: "desc" },
      include: { breaks: { where: { endedAt: null } } },
    });
    const todayShifts = await db().shift.findMany({ where: { userId: ctx.auth.userId, OR: [{ clockInAt: dayRange }, { clockOutAt: null }] }, include: { breaks: true } });
    const minUnpaid = overtimeRules(org).minUnpaidBreakMinutes ?? DEFAULT_MIN_UNPAID_BREAK_MINUTES;
    return {
      date: today,
      timezone: org.timezone,
      tasks: assignments
        .map((a) => ({ ...a.task, scheduledStart: a.scheduledStart ? fromDbDate(a.scheduledStart) : null }))
        .sort((a, b) => Number(a.status === "DONE") - Number(b.status === "DONE") || a.project.name.localeCompare(b.project.name) || a.sortOrder - b.sortOrder),
      running: running && { entryId: running.id, taskId: running.taskId, projectId: running.projectId, startedAt: running.startedAt.toISOString() },
      shift: openShift && {
        shiftId: openShift.id,
        clockedInAt: openShift.clockInAt.toISOString(),
        projectId: openShift.projectId,
        onBreak: openShift.breaks[0] ? { breakId: openShift.breaks[0].id, startedAt: openShift.breaks[0].startedAt.toISOString() } : null,
      },
      /** Paid minutes today (live), from shifts, regardless of task allocation. */
      paidMinutesToday: todayShifts.reduce((a, s) => a + paidShiftMinutes(s, { now: new Date(), minUnpaidBreakMinutes: minUnpaid }), 0),
      entries: entries.map((e) => ({ id: e.id, taskId: e.taskId, taskTitle: e.task?.title ?? null, startedAt: e.startedAt, endedAt: e.endedAt, breakMinutes: e.breakMinutes })),
    };
  }),

  /** Current (or offset) pay period: entries, live OT totals and timesheet status. */
  myPeriod: authedProcedure.input(z.object({ offset: z.number().int().min(-26).max(0).default(0) }).default({ offset: 0 })).query(async ({ ctx, input }) => {
    const org = await db().organization.findUniqueOrThrow({ where: { id: ctx.auth.orgId } });
    let period = await getOrCreatePayPeriod(db(), org, toLocalDate(new Date(), org.timezone));
    for (let i = 0; i < -input.offset; i++) {
      period = await getOrCreatePayPeriod(db(), org, addDays(fromDbDate(period.startDate), -1));
    }
    const totals = await computeTotals(db(), org, ctx.auth.userId, period, { live: true });
    const timesheet = await db().timesheet.findUnique({ where: { userId_payPeriodId: { userId: ctx.auth.userId, payPeriodId: period.id } } });
    return {
      period: { id: period.id, start: fromDbDate(period.startDate), end: fromDbDate(period.endDate) },
      timesheet: timesheet && { id: timesheet.id, status: timesheet.status, reviewNote: timesheet.reviewNote, submittedAt: timesheet.submittedAt },
      totals: totals.overtime,
      hasOpenShift: totals.hasOpenShift,
      allocatedMinutes: totals.allocatedMinutes,
      shifts: totals.shifts,
    };
  }),

  submitTimesheet: authedProcedure.input(z.object({ payPeriodId: z.string() })).mutation(async ({ ctx, input }) => {
    const org = await db().organization.findUniqueOrThrow({ where: { id: ctx.auth.orgId } });
    return db().$transaction((tx) => submitTimesheet(tx, org, ctx.auth.userId, input.payPeriodId));
  }),

  /** Projects the worker can file expenses against, with their assigned tasks. */
  expenseTargets: authedProcedure.query(async ({ ctx }) => {
    const assignments = await db().taskAssignment.findMany({
      where: { userId: ctx.auth.userId, task: { project: { orgId: ctx.auth.orgId, status: { in: ["ACTIVE", "PLANNING"] } } } },
      include: { task: { select: { id: true, title: true, project: { select: { id: true, name: true } } } } },
    });
    const byProject = new Map<string, { id: string; name: string; tasks: { id: string; title: string }[] }>();
    for (const a of assignments) {
      const p = byProject.get(a.task.project.id) ?? { ...a.task.project, tasks: [] };
      p.tasks.push({ id: a.task.id, title: a.task.title });
      byProject.set(p.id, p);
    }
    return [...byProject.values()];
  }),

  myExpenses: authedProcedure.query(({ ctx }) =>
    db().expense.findMany({
      where: { userId: ctx.auth.userId, orgId: ctx.auth.orgId },
      orderBy: { spentOn: "desc" },
      take: 50,
      include: { project: { select: { name: true } } },
    }),
  ),

  /** Offline outbox flush. */
  sync: authedProcedure.input(syncPushInput).mutation(({ ctx, input }) => applyOps(ctx.auth, input.ops)),
});
