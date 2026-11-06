import { dbDate, fromDbDate } from "@timepeace/db";
import {
  TAX_CATEGORIES,
  deductibleCents,
  estimatedTaxWorksheet,
  evaluate1099,
  taxCategoryById,
  taxFormFor,
  toLocalDate,
  type Payment1099,
  type PaymentMethod,
  type VendorTaxClass,
} from "@timepeace/shared";
import type { Tx } from "../lib/db";

/** Known defaults; editable per org/year. Verify against IRS guidance each year. */
function defaultSettings(year: number) {
  return {
    form1099ThresholdCents: year >= 2026 ? 200_000 : 60_000,
    mileageRateMilliCents: year >= 2026 ? 7250 : year === 2025 ? 7000 : 6700,
  };
}

export async function taxSettings(tx: Tx, orgId: string, year: number) {
  return tx.taxYearSettings.upsert({
    where: { orgId_year: { orgId, year } },
    create: { orgId, year, ...defaultSettings(year) },
    update: {},
  });
}

const yearDates = (year: number) => ({ gte: dbDate(`${year}-01-01`), lt: dbDate(`${year + 1}-01-01`) });

/** Expenses that count for the year (by date spent; rejected excluded). */
export function yearExpenses(tx: Tx, orgId: string, year: number) {
  return tx.expense.findMany({
    where: { orgId, spentOn: yearDates(year), status: { not: "REJECTED" } },
    include: { project: { select: { name: true } }, vendor: { select: { name: true } }, receipt: { select: { id: true, storageKey: true, contentType: true } } },
    orderBy: { spentOn: "asc" },
  });
}

/** Payroll from approved timesheets whose pay period ends in the year. */
async function yearPayroll(tx: Tx, orgId: string, year: number) {
  const sheets = await tx.timesheet.findMany({
    where: { orgId, status: { in: ["APPROVED", "EXPORTED", "PAID"] }, payPeriod: { endDate: yearDates(year) } },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  const profiles = await tx.workerProfile.findMany({ where: { orgId }, select: { userId: true, classification: true, vendorId: true } });
  const byUser = new Map(profiles.map((p) => [p.userId, p]));
  return sheets.map((s) => ({ ...s, classification: byUser.get(s.userId)?.classification ?? "W2", vendorId: byUser.get(s.userId)?.vendorId ?? null }));
}

export async function taxSummary(tx: Tx, orgId: string, year: number) {
  const org = await tx.organization.findUniqueOrThrow({ where: { id: orgId } });
  const settings = await taxSettings(tx, orgId, year);
  const form = taxFormFor(org.entityType);

  const payments = await tx.payment.findMany({
    where: { receivedOn: yearDates(year), invoice: { project: { orgId } } },
    include: { invoice: { include: { project: { select: { name: true } } } } },
  });
  const invoices = await tx.invoice.findMany({ where: { issuedOn: yearDates(year), status: { not: "VOID" }, project: { orgId } } });
  const expenses = await yearExpenses(tx, orgId, year);
  const payroll = await yearPayroll(tx, orgId, year);
  const mileage = await tx.mileageLog.findMany({ where: { orgId, date: yearDates(year) } });

  // Group by tax line.
  const lines = new Map<string, { amountCents: number; deductibleCents: number; count: number; missingReceipts: number }>();
  const add = (cat: string, amount: number, deductible: number, missingReceipt = false) => {
    const l = lines.get(cat) ?? { amountCents: 0, deductibleCents: 0, count: 0, missingReceipts: 0 };
    l.amountCents += amount;
    l.deductibleCents += deductible;
    l.count += 1;
    if (missingReceipt) l.missingReceipts += 1;
    lines.set(cat, l);
  };
  for (const e of expenses) add(e.taxCategory, e.amountCents, deductibleCents(e.taxCategory, e.amountCents), !e.receiptFileId && e.amountCents >= 75_00);

  const w2Wages = payroll.filter((p) => p.classification === "W2").reduce((a, p) => a + (p.grossCents ?? 0), 0);
  const contractorPay = payroll.filter((p) => p.classification === "CONTRACTOR_1099").reduce((a, p) => a + (p.grossCents ?? 0), 0);
  if (w2Wages) add("job_labor", w2Wages, w2Wages);
  if (contractorPay) add("job_subcontractors", contractorPay, contractorPay);

  const miles = mileage.reduce((a, m) => a + m.miles, 0);
  const mileageCents = Math.round((miles * settings.mileageRateMilliCents) / 100);
  if (mileageCents) add("vehicle", mileageCents, mileageCents);

  const lineRows = TAX_CATEGORIES.filter((c) => lines.has(c.id)).map((c) => ({
    id: c.id,
    label: c.label,
    formLine: form === "scheduleC" ? c.scheduleC : form === "form1120S" ? c.form1120S : null,
    costOfGoodsSold: c.costOfGoodsSold,
    capitalize: !!c.capitalize,
    ...lines.get(c.id)!,
  }));
  const sum = (rows: typeof lineRows) => rows.reduce((a, r) => a + r.deductibleCents, 0);
  const revenueCents = payments.reduce((a, p) => a + p.amountCents, 0);
  const cogsCents = sum(lineRows.filter((r) => r.costOfGoodsSold));
  const deductionsCents = sum(lineRows.filter((r) => !r.costOfGoodsSold && !r.capitalize));

  const flags: { level: "warn" | "info"; message: string }[] = [];
  const uncategorized = expenses.filter((e) => e.taxCategory === "other").length;
  if (uncategorized) flags.push({ level: "warn", message: `${uncategorized} expense(s) are in "Other". Recategorize them so they land on the right line.` });
  const missing = expenses.filter((e) => !e.receiptFileId && e.amountCents >= 75_00).length;
  if (missing) flags.push({ level: "warn", message: `${missing} expense(s) of $75 or more have no receipt attached.` });
  const unpaid = payroll.filter((p) => p.status !== "PAID").length;
  if (unpaid) flags.push({ level: "info", message: `${unpaid} approved timesheet(s) aren't marked paid yet. Wages here are estimates; your payroll provider's annual reports are authoritative.` });
  if (miles > 0 && lines.has("fuel")) flags.push({ level: "warn", message: "Both mileage and fuel are recorded. For the same vehicle you generally use the standard mileage rate OR actual costs, not both." });
  if (form === "other") flags.push({ level: "info", message: `Line mapping isn't provided yet for ${org.entityType.replace("_", " ").toLowerCase()} returns; totals by category still apply.` });
  const missingMethod = expenses.filter((e) => e.paidBy === "COMPANY" && !e.paymentMethod && e.vendorId).length;
  if (missingMethod) flags.push({ level: "info", message: `${missingMethod} company payment(s) to vendors have no payment method recorded (needed to exclude card payments from 1099s).` });

  return {
    year,
    entityType: org.entityType,
    form,
    basis: "cash" as const,
    settings,
    revenue: {
      receivedCents: revenueCents,
      invoicedCents: invoices.reduce((a, i) => a + i.amountCents, 0),
      byProject: Object.values(
        payments.reduce<Record<string, { project: string; cents: number }>>((acc, p) => {
          const k = p.invoice.project.name;
          acc[k] = { project: k, cents: (acc[k]?.cents ?? 0) + p.amountCents };
          return acc;
        }, {}),
      ),
    },
    lines: lineRows,
    cogsCents,
    deductionsCents,
    netProfitCents: revenueCents - cogsCents - deductionsCents,
    payroll: { w2WagesCents: w2Wages, contractorPayCents: contractorPay, timesheets: payroll.length },
    mileage: { miles: Math.round(miles * 10) / 10, rateMilliCents: settings.mileageRateMilliCents, deductionCents: mileageCents, trips: mileage.length },
    salesTaxPaidCents: expenses.reduce((a, e) => a + e.salesTaxCents, 0),
    capitalPurchases: expenses
      .filter((e) => taxCategoryById(e.taxCategory)?.capitalize)
      .map((e) => ({ id: e.id, spentOn: fromDbDate(e.spentOn), vendorName: e.vendorName, amountCents: e.amountCents, note: e.note })),
    flags,
  };
}

export async function vendors1099(tx: Tx, orgId: string, year: number) {
  const settings = await taxSettings(tx, orgId, year);
  const vendors = await tx.vendor.findMany({ where: { orgId }, orderBy: { name: "asc" } });
  const expenses = await tx.expense.findMany({
    where: { orgId, vendorId: { not: null }, paidBy: "COMPANY", status: { not: "REJECTED" }, spentOn: yearDates(year) },
    select: { vendorId: true, amountCents: true, paymentMethod: true },
  });
  const payroll = (await yearPayroll(tx, orgId, year)).filter((p) => p.classification === "CONTRACTOR_1099" && p.vendorId);

  return vendors
    .map((v) => {
      const pays: Payment1099[] = [
        ...expenses.filter((e) => e.vendorId === v.id).map((e) => ({ amountCents: e.amountCents, method: (e.paymentMethod ?? null) as PaymentMethod | null, source: "EXPENSE" as const })),
        ...payroll.filter((p) => p.vendorId === v.id).map((p) => ({ amountCents: p.grossCents ?? 0, method: "ACH" as const, source: "PAYROLL" as const })),
      ];
      const result = evaluate1099(
        {
          is1099Eligible: v.is1099Eligible,
          w9OnFile: v.w9OnFile,
          tinOnFile: !!v.tinLast4,
          taxClassification: (v.taxClassification ?? null) as VendorTaxClass | null,
          isAttorney: v.isAttorney,
        },
        pays,
        settings.form1099ThresholdCents,
      );
      return {
        vendor: {
          id: v.id,
          name: v.name,
          is1099Eligible: v.is1099Eligible,
          isSubcontractor: v.isSubcontractor,
          w9OnFile: v.w9OnFile,
          w9ReceivedOn: v.w9ReceivedOn ? fromDbDate(v.w9ReceivedOn) : null,
          tinLast4: v.tinLast4,
          taxClassification: v.taxClassification,
          isAttorney: v.isAttorney,
          email: v.email,
          address: v.address,
        },
        payments: pays.length,
        totalPaidCents: pays.reduce((a, p) => a + p.amountCents, 0),
        ...result,
      };
    })
    .filter((r) => r.payments > 0 || r.vendor.is1099Eligible)
    .sort((a, b) => order(a.status) - order(b.status) || b.reportableCents - a.reportableCents);
}
const order = (s: string) => ({ FILE: 0, BELOW_THRESHOLD: 1, EXEMPT_CORPORATION: 2, NOT_SERVICE_VENDOR: 3 })[s] ?? 9;

export async function estimates(tx: Tx, orgId: string, year: number) {
  const org = await tx.organization.findUniqueOrThrow({ where: { id: orgId } });
  const summary = await taxSummary(tx, orgId, year);
  const settings = summary.settings;
  const payments = await tx.estimatedTaxPayment.findMany({ where: { orgId, year }, orderBy: { paidOn: "asc" } });
  const today = toLocalDate(new Date(), org.timezone);
  const asOf = today > `${year}-12-31` ? `${year}-12-31` : today < `${year}-01-01` ? `${year}-01-01` : today;
  const worksheet = estimatedTaxWorksheet({
    year,
    asOf,
    ytdNetProfitCents: summary.netProfitCents,
    effectiveRateBps: settings.estimatedTaxRateBps,
    priorYearTaxCents: settings.priorYearTaxCents,
    priorYearAgiOver150k: settings.priorYearAgiOver150k,
    payments: payments.map((p) => ({ quarter: p.quarter as 1 | 2 | 3 | 4, amountCents: p.amountCents })),
  });
  return {
    asOf,
    entityType: org.entityType,
    ytdNetProfitCents: summary.netProfitCents,
    settings,
    payments: payments.map((p) => ({ ...p, paidOn: fromDbDate(p.paidOn) })),
    worksheet,
  };
}
