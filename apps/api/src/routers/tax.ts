import { dbDate, fromDbDate } from "@timepeace/db";
import { COST_CATEGORIES, PAYMENT_METHODS, TAX_CATEGORIES, VENDOR_TAX_CLASSES, deductibleCents, taxCategoryById } from "@timepeace/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { audit } from "../lib/audit";
import { encryptField } from "../lib/crypto";
import { db } from "../lib/db";
import { estimates, taxSettings, taxSummary, vendors1099, yearExpenses } from "../services/tax";
import { roleProcedure, router } from "../trpc";

/** Tax center: owners and the company's accountant/CPA. */
export const taxProcedure = roleProcedure(["OWNER", "ACCOUNTANT"]);
const year = z.number().int().min(2000).max(2100);
const taxCategoryId = z.string().refine((id) => !!taxCategoryById(id), "Unknown tax category");

export const taxRouter = router({
  categories: taxProcedure.query(() => TAX_CATEGORIES),

  summary: taxProcedure.input(z.object({ year })).query(({ ctx, input }) => taxSummary(db(), ctx.auth.orgId, input.year)),

  expenses: taxProcedure.input(z.object({ year, taxCategory: z.string().optional() })).query(async ({ ctx, input }) => {
    const rows = await yearExpenses(db(), ctx.auth.orgId, input.year);
    return rows
      .filter((e) => !input.taxCategory || e.taxCategory === input.taxCategory)
      .map((e) => ({
        id: e.id,
        spentOn: fromDbDate(e.spentOn),
        vendorName: e.vendorName,
        projectName: e.project?.name ?? null,
        amountCents: e.amountCents,
        salesTaxCents: e.salesTaxCents,
        deductibleCents: deductibleCents(e.taxCategory, e.amountCents),
        taxCategory: e.taxCategory,
        category: e.category,
        paidBy: e.paidBy,
        paymentMethod: e.paymentMethod,
        hasReceipt: !!e.receiptFileId,
        receiptFileId: e.receiptFileId,
        note: e.note,
        status: e.status,
      }));
  }),

  setExpenseTax: taxProcedure
    .input(z.object({ expenseId: z.string(), taxCategory: taxCategoryId.optional(), paymentMethod: z.enum(PAYMENT_METHODS).nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      return db().$transaction(async (tx) => {
        const e = await tx.expense.findFirst({ where: { id: input.expenseId, orgId: ctx.auth.orgId } });
        if (!e) throw new TRPCError({ code: "NOT_FOUND" });
        const data = {
          ...(input.taxCategory ? { taxCategory: input.taxCategory } : {}),
          ...(input.paymentMethod !== undefined ? { paymentMethod: input.paymentMethod } : {}),
        };
        const updated = await tx.expense.update({ where: { id: e.id }, data });
        await audit(tx, { orgId: ctx.auth.orgId, actorId: ctx.auth.userId, entityType: "Expense", entityId: e.id, action: "tax.update", before: { taxCategory: e.taxCategory, paymentMethod: e.paymentMethod }, after: data });
        return updated;
      });
    }),

  /** Company overhead (insurance, phones, office…) entered from the office, optionally charged to a job. */
  addExpense: taxProcedure
    .input(
      z.object({
        spentOn: z.iso.date(),
        vendorName: z.string().min(1).max(200),
        amountCents: z.number().int().positive(),
        salesTaxCents: z.number().int().nonnegative().default(0),
        taxCategory: taxCategoryId,
        category: z.enum(COST_CATEGORIES).default("OTHER"),
        paymentMethod: z.enum(PAYMENT_METHODS).nullable().default(null),
        projectId: z.string().nullish(),
        note: z.string().max(2000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.projectId) {
        const p = await db().project.findFirst({ where: { id: input.projectId, orgId: ctx.auth.orgId } });
        if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }
      const vendor = await db().vendor.findFirst({ where: { orgId: ctx.auth.orgId, name: { equals: input.vendorName, mode: "insensitive" } } });
      return db().expense.create({
        data: {
          orgId: ctx.auth.orgId,
          userId: ctx.auth.userId,
          projectId: input.projectId ?? null,
          vendorId: vendor?.id,
          vendorName: input.vendorName,
          amountCents: input.amountCents,
          salesTaxCents: input.salesTaxCents,
          taxCategory: input.taxCategory,
          category: input.category,
          paidBy: "COMPANY",
          paymentMethod: input.paymentMethod,
          spentOn: dbDate(input.spentOn),
          note: input.note,
          status: "APPROVED",
          reviewedById: ctx.auth.userId,
          reviewedAt: new Date(),
        },
      });
    }),

  vendors1099: taxProcedure.input(z.object({ year })).query(({ ctx, input }) => vendors1099(db(), ctx.auth.orgId, input.year)),

  updateVendor: taxProcedure
    .input(
      z.object({
        vendorId: z.string(),
        is1099Eligible: z.boolean().optional(),
        w9OnFile: z.boolean().optional(),
        w9ReceivedOn: z.iso.date().nullish(),
        taxClassification: z.enum(VENDOR_TAX_CLASSES).nullish(),
        isAttorney: z.boolean().optional(),
        /** SSN or EIN, digits only (dashes allowed). Stored encrypted; only the last 4 are ever returned. */
        tin: z
          .string()
          .transform((s) => s.replace(/\D/g, ""))
          .refine((s) => s.length === 9, "TIN must be 9 digits")
          .optional(),
        email: z.email().nullish(),
        address: z.string().max(500).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { vendorId, tin, w9ReceivedOn, ...rest } = input;
      return db().$transaction(async (tx) => {
        const v = await tx.vendor.findFirst({ where: { id: vendorId, orgId: ctx.auth.orgId } });
        if (!v) throw new TRPCError({ code: "NOT_FOUND" });
        await tx.vendor.update({
          where: { id: v.id },
          data: {
            ...rest,
            ...(w9ReceivedOn !== undefined ? { w9ReceivedOn: w9ReceivedOn ? dbDate(w9ReceivedOn) : null } : {}),
            ...(tin ? { tinEncrypted: encryptField(tin), tinLast4: tin.slice(-4) } : {}),
          },
        });
        // Never write the TIN itself to the audit log.
        await audit(tx, { orgId: ctx.auth.orgId, actorId: ctx.auth.userId, entityType: "Vendor", entityId: v.id, action: "tax.update", after: { ...rest, w9ReceivedOn, tinUpdated: !!tin } });
        return { ok: true };
      });
    }),

  mileage: taxProcedure.input(z.object({ year })).query(async ({ ctx, input }) => {
    const settings = await taxSettings(db(), ctx.auth.orgId, input.year);
    const rows = await db().mileageLog.findMany({
      where: { orgId: ctx.auth.orgId, date: { gte: dbDate(`${input.year}-01-01`), lt: dbDate(`${input.year + 1}-01-01`) } },
      include: { user: { select: { name: true } }, project: { select: { name: true } } },
      orderBy: { date: "desc" },
    });
    return {
      rateMilliCents: settings.mileageRateMilliCents,
      rows: rows.map((r) => ({ ...r, date: fromDbDate(r.date), deductionCents: Math.round((r.miles * settings.mileageRateMilliCents) / 100) })),
    };
  }),

  addMileage: taxProcedure
    .input(z.object({ date: z.iso.date(), miles: z.number().positive().max(2000), purpose: z.string().min(2).max(300), fromPlace: z.string().max(200).nullish(), toPlace: z.string().max(200).nullish(), projectId: z.string().nullish(), userId: z.string().nullish() }))
    .mutation(async ({ ctx, input }) => {
      const userId = input.userId ?? ctx.auth.userId;
      const m = await db().membership.findUnique({ where: { orgId_userId: { orgId: ctx.auth.orgId, userId } } });
      if (!m) throw new TRPCError({ code: "BAD_REQUEST", message: "Driver is not a member" });
      return db().mileageLog.create({
        data: { orgId: ctx.auth.orgId, userId, projectId: input.projectId ?? null, date: dbDate(input.date), miles: input.miles, purpose: input.purpose, fromPlace: input.fromPlace, toPlace: input.toPlace },
      });
    }),

  deleteMileage: taxProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    await db().mileageLog.deleteMany({ where: { id: input.id, orgId: ctx.auth.orgId } });
    return { ok: true };
  }),

  estimates: taxProcedure.input(z.object({ year })).query(({ ctx, input }) => estimates(db(), ctx.auth.orgId, input.year)),

  addEstimatePayment: taxProcedure
    .input(z.object({ year, quarter: z.number().int().min(1).max(4), amountCents: z.number().int().positive(), paidOn: z.iso.date(), note: z.string().max(500).nullish() }))
    .mutation(({ ctx, input }) => db().estimatedTaxPayment.create({ data: { orgId: ctx.auth.orgId, ...input, paidOn: dbDate(input.paidOn) } })),

  deleteEstimatePayment: taxProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    await db().estimatedTaxPayment.deleteMany({ where: { id: input.id, orgId: ctx.auth.orgId } });
    return { ok: true };
  }),

  updateSettings: taxProcedure
    .input(
      z.object({
        year,
        form1099ThresholdCents: z.number().int().positive().optional(),
        mileageRateMilliCents: z.number().int().positive().max(20_000).optional(),
        estimatedTaxRateBps: z.number().int().min(0).max(6000).optional(),
        priorYearTaxCents: z.number().int().nonnegative().nullable().optional(),
        priorYearAgiOver150k: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { year: y, ...data } = input;
      await taxSettings(db(), ctx.auth.orgId, y);
      return db().$transaction(async (tx) => {
        const s = await tx.taxYearSettings.update({ where: { orgId_year: { orgId: ctx.auth.orgId, year: y } }, data });
        await audit(tx, { orgId: ctx.auth.orgId, actorId: ctx.auth.userId, entityType: "TaxYearSettings", entityId: s.id, action: "update", after: data });
        return s;
      });
    }),
});
