import { fromDbDate } from "@timepeace/db";
import { MATERIAL_REQUEST_STATUSES, editShiftInput, editTimeEntryInput, reviewExpenseInput, reviewTimesheetInput } from "@timepeace/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { audit } from "../lib/audit";
import { db } from "../lib/db";
import { assertPeriodOpen, computeTotals, reviewTimesheet } from "../services/timesheet";
import { managerProcedure, router } from "../trpc";

export const approvalsRouter = router({
  summary: managerProcedure.query(async ({ ctx }) => {
    const [timesheets, expenses, materials] = await Promise.all([
      db().timesheet.count({ where: { orgId: ctx.auth.orgId, status: "SUBMITTED" } }),
      db().expense.count({ where: { orgId: ctx.auth.orgId, status: "SUBMITTED" } }),
      db().materialRequest.count({ where: { task: { project: { orgId: ctx.auth.orgId } }, status: "REQUESTED" } }),
    ]);
    return { timesheets, expenses, materials };
  }),

  timesheets: managerProcedure.input(z.object({ status: z.enum(["SUBMITTED", "APPROVED", "REJECTED"]).default("SUBMITTED") }).default({ status: "SUBMITTED" })).query(async ({ ctx, input }) => {
    const org = await db().organization.findUniqueOrThrow({ where: { id: ctx.auth.orgId } });
    const sheets = await db().timesheet.findMany({
      where: { orgId: org.id, status: input.status },
      include: { user: { select: { id: true, name: true } }, payPeriod: true },
      orderBy: [{ payPeriod: { startDate: "desc" } }, { user: { name: "asc" } }],
    });
    const out = [];
    for (const s of sheets) {
      const totals = await computeTotals(db(), org, s.userId, s.payPeriod);
      out.push({
        id: s.id,
        status: s.status,
        user: s.user,
        period: { start: fromDbDate(s.payPeriod.startDate), end: fromDbDate(s.payPeriod.endDate) },
        submittedAt: s.submittedAt,
        reviewNote: s.reviewNote,
        totals: totals.overtime,
        isContractor: totals.isContractor,
        allocatedMinutes: totals.allocatedMinutes,
        needsReview: totals.needsReview,
        shifts: totals.shifts,
      });
    }
    return out;
  }),

  reviewTimesheet: managerProcedure.input(reviewTimesheetInput).mutation(async ({ ctx, input }) => {
    const org = await db().organization.findUniqueOrThrow({ where: { id: ctx.auth.orgId } });
    return db().$transaction(async (tx) => {
      const ts = await reviewTimesheet(tx, org, ctx.auth.userId, input.timesheetId, input.decision, input.note);
      await audit(tx, { orgId: org.id, actorId: ctx.auth.userId, entityType: "Timesheet", entityId: ts.id, action: input.decision.toLowerCase(), after: { status: ts.status, regularMinutes: ts.regularMinutes, overtimeMinutes: ts.overtimeMinutes }, reason: input.note });
      return ts;
    });
  }),

  /** Manager correction of a shift's clock-in/out (the PAID time); requires a reason and is audited. */
  editShift: managerProcedure.input(editShiftInput).mutation(async ({ ctx, input }) => {
    const org = await db().organization.findUniqueOrThrow({ where: { id: ctx.auth.orgId } });
    const start = new Date(input.clockInAt);
    const end = new Date(input.clockOutAt);
    if (end <= start) throw new TRPCError({ code: "BAD_REQUEST", message: "Clock-out must be after clock-in" });
    return db().$transaction(async (tx) => {
      const shift = await tx.shift.findFirst({ where: { id: input.id, orgId: org.id } });
      if (!shift) throw new TRPCError({ code: "NOT_FOUND" });
      await assertPeriodOpen(tx, org, shift.userId, shift.clockInAt);
      await assertPeriodOpen(tx, org, shift.userId, start);
      const updated = await tx.shift.update({ where: { id: shift.id }, data: { clockInAt: start, clockOutAt: end, flag: "EDITED", source: "MANUAL" } });
      await audit(tx, {
        orgId: org.id,
        actorId: ctx.auth.userId,
        entityType: "Shift",
        entityId: shift.id,
        action: "edit",
        before: { clockInAt: shift.clockInAt, clockOutAt: shift.clockOutAt, flag: shift.flag },
        after: { clockInAt: start, clockOutAt: end },
        reason: input.reason,
      });
      return updated;
    });
  }),

  /** Manager correction of a task time entry (job-cost allocation); requires a reason and is audited. */
  editTimeEntry: managerProcedure.input(editTimeEntryInput).mutation(async ({ ctx, input }) => {
    const org = await db().organization.findUniqueOrThrow({ where: { id: ctx.auth.orgId } });
    const start = new Date(input.startedAt);
    const end = new Date(input.endedAt);
    if (end <= start) throw new TRPCError({ code: "BAD_REQUEST", message: "End must be after start" });
    return db().$transaction(async (tx) => {
      const entry = await tx.timeEntry.findFirst({ where: { id: input.id, orgId: org.id } });
      if (!entry) throw new TRPCError({ code: "NOT_FOUND" });
      await assertPeriodOpen(tx, org, entry.userId, entry.startedAt);
      await assertPeriodOpen(tx, org, entry.userId, start);
      const updated = await tx.timeEntry.update({ where: { id: entry.id }, data: { startedAt: start, endedAt: end, breakMinutes: input.breakMinutes, source: "MANUAL" } });
      await audit(tx, {
        orgId: org.id,
        actorId: ctx.auth.userId,
        entityType: "TimeEntry",
        entityId: entry.id,
        action: "edit",
        before: { startedAt: entry.startedAt, endedAt: entry.endedAt, breakMinutes: entry.breakMinutes },
        after: { startedAt: start, endedAt: end, breakMinutes: input.breakMinutes },
        reason: input.reason,
      });
      return updated;
    });
  }),

  expenses: managerProcedure.input(z.object({ status: z.enum(["SUBMITTED", "APPROVED", "REJECTED", "REIMBURSED"]).default("SUBMITTED") }).default({ status: "SUBMITTED" })).query(({ ctx, input }) =>
    db().expense.findMany({
      where: { orgId: ctx.auth.orgId, status: input.status },
      include: { user: { select: { name: true } }, project: { select: { name: true } }, task: { select: { title: true } }, costCode: true },
      orderBy: { spentOn: "desc" },
    }),
  ),

  reviewExpense: managerProcedure.input(reviewExpenseInput).mutation(async ({ ctx, input }) => {
    return db().$transaction(async (tx) => {
      const e = await tx.expense.findFirst({ where: { id: input.expenseId, orgId: ctx.auth.orgId } });
      if (!e) throw new TRPCError({ code: "NOT_FOUND" });
      if (e.status !== "SUBMITTED") throw new TRPCError({ code: "CONFLICT", message: `Expense is ${e.status.toLowerCase()}` });
      if (input.decision === "REJECT" && !input.note) throw new TRPCError({ code: "BAD_REQUEST", message: "A note is required when rejecting" });
      const updated = await tx.expense.update({
        where: { id: e.id },
        data: { status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED", reviewedById: ctx.auth.userId, reviewedAt: new Date(), reviewNote: input.note ?? null },
      });
      await audit(tx, { orgId: ctx.auth.orgId, actorId: ctx.auth.userId, entityType: "Expense", entityId: e.id, action: input.decision.toLowerCase(), reason: input.note });
      return updated;
    });
  }),

  materialRequests: managerProcedure.query(({ ctx }) =>
    db().materialRequest.findMany({
      where: { task: { project: { orgId: ctx.auth.orgId } }, status: { in: ["REQUESTED", "ORDERED"] } },
      include: { requestedBy: { select: { name: true } }, task: { select: { id: true, title: true, project: { select: { id: true, name: true } } } } },
      orderBy: { createdAt: "asc" },
    }),
  ),

  updateMaterialRequest: managerProcedure.input(z.object({ id: z.string(), status: z.enum(MATERIAL_REQUEST_STATUSES) })).mutation(async ({ ctx, input }) => {
    const r = await db().materialRequest.findFirst({ where: { id: input.id, task: { project: { orgId: ctx.auth.orgId } } } });
    if (!r) throw new TRPCError({ code: "NOT_FOUND" });
    return db().materialRequest.update({ where: { id: r.id }, data: { status: input.status } });
  }),
});
