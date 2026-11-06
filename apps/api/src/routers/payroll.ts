import { fromDbDate } from "@timepeace/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { audit } from "../lib/audit";
import { db } from "../lib/db";
import { payrollRows } from "../services/payroll";
import { payrollProcedure, router } from "../trpc";

export const payrollRouter = router({
  periods: payrollProcedure.query(async ({ ctx }) => {
    const periods = await db().payPeriod.findMany({
      where: { orgId: ctx.auth.orgId },
      orderBy: { startDate: "desc" },
      take: 12,
      include: { timesheets: { select: { status: true } }, exports: { orderBy: { createdAt: "desc" } } },
    });
    return periods.map((p) => {
      const counts: Record<string, number> = {};
      for (const t of p.timesheets) counts[t.status] = (counts[t.status] ?? 0) + 1;
      return {
        id: p.id,
        start: fromDbDate(p.startDate),
        end: fromDbDate(p.endDate),
        counts,
        exports: p.exports.map((e) => ({ id: e.id, format: e.format, createdAt: e.createdAt, paidAt: e.paidAt })),
      };
    });
  }),

  /** HR queue: approved timesheets ready to export, plus reimbursements. */
  period: payrollProcedure.input(z.object({ payPeriodId: z.string() })).query(async ({ ctx, input }) => {
    const period = await db().payPeriod.findFirst({ where: { id: input.payPeriodId, orgId: ctx.auth.orgId } });
    if (!period) throw new TRPCError({ code: "NOT_FOUND" });
    const pending = await db().timesheet.findMany({
      where: { orgId: ctx.auth.orgId, payPeriodId: period.id, status: { in: ["DRAFT", "SUBMITTED", "REJECTED"] } },
      include: { user: { select: { name: true } } },
    });
    return {
      period: { id: period.id, start: fromDbDate(period.startDate), end: fromDbDate(period.endDate) },
      rows: await payrollRows(db(), ctx.auth.orgId, period.id),
      notReady: pending.map((t) => ({ name: t.user.name, status: t.status })),
    };
  }),

  /** Lock approved timesheets into an export batch. The file itself is downloaded via REST. */
  createExport: payrollProcedure
    .input(z.object({ payPeriodId: z.string(), format: z.enum(["GENERIC_CSV", "PDF"]) }))
    .mutation(async ({ ctx, input }) => {
      return db().$transaction(async (tx) => {
        const rows = (await payrollRows(tx, ctx.auth.orgId, input.payPeriodId)).filter((r) => r.status === "APPROVED");
        if (rows.length === 0) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No approved timesheets to export" });
        const exp = await tx.payrollExport.create({
          data: { orgId: ctx.auth.orgId, payPeriodId: input.payPeriodId, format: input.format, createdById: ctx.auth.userId },
        });
        await tx.timesheet.updateMany({ where: { id: { in: rows.map((r) => r.timesheetId) }, status: "APPROVED" }, data: { status: "EXPORTED", payrollExportId: exp.id } });
        await tx.expense.updateMany({ where: { id: { in: rows.flatMap((r) => r.reimbursementExpenseIds) } }, data: { payrollExportId: exp.id } });
        await audit(tx, { orgId: ctx.auth.orgId, actorId: ctx.auth.userId, entityType: "PayrollExport", entityId: exp.id, action: "create", after: { timesheets: rows.length, format: input.format } });
        return { exportId: exp.id, timesheets: rows.length };
      });
    }),

  markPaid: payrollProcedure.input(z.object({ exportId: z.string() })).mutation(async ({ ctx, input }) => {
    return db().$transaction(async (tx) => {
      const exp = await tx.payrollExport.findFirst({ where: { id: input.exportId, orgId: ctx.auth.orgId } });
      if (!exp) throw new TRPCError({ code: "NOT_FOUND" });
      if (exp.paidAt) return { ok: true };
      const now = new Date();
      await tx.payrollExport.update({ where: { id: exp.id }, data: { paidAt: now } });
      await tx.timesheet.updateMany({ where: { payrollExportId: exp.id }, data: { status: "PAID", paidAt: now } });
      await tx.expense.updateMany({ where: { payrollExportId: exp.id }, data: { status: "REIMBURSED", reimbursedAt: now } });
      await audit(tx, { orgId: ctx.auth.orgId, actorId: ctx.auth.userId, entityType: "PayrollExport", entityId: exp.id, action: "markPaid" });
      return { ok: true };
    });
  }),
});
