import { fromDbDate } from "@timepeace/db";
import { VENDOR_TAX_CLASS_LABELS, deductibleCents, minutesToHours, taxCategoryById, taxFormFor, toCsv, type VendorTaxClass } from "@timepeace/shared";
import { strToU8, zipSync, type Zippable } from "fflate";
import type { Tx } from "../lib/db";
import { storage } from "../lib/storage";
import { projectJobCost } from "./jobCost";
import { estimates, taxSummary, vendors1099, yearExpenses } from "./tax";

const money = (c: number) => (c / 100).toFixed(2);
const safe = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40) || "x";

/**
 * Year-end package for the CPA: CSVs plus receipt images, zipped. Everything is derived from
 * records in Timepeace; payroll-provider and bank statements remain the authoritative sources.
 */
export async function buildCpaPackage(tx: Tx, orgId: string, year: number): Promise<{ filename: string; data: Uint8Array }> {
  const org = await tx.organization.findUniqueOrThrow({ where: { id: orgId } });
  const summary = await taxSummary(tx, orgId, year);
  const form = taxFormFor(org.entityType);
  const lineOf = (id: string) => {
    const c = taxCategoryById(id);
    return form === "scheduleC" ? c?.scheduleC : form === "form1120S" ? c?.form1120S : "";
  };
  const files: Zippable = {};
  const put = (name: string, csv: string) => (files[name] = strToU8(csv));

  put(
    "profit_and_loss.csv",
    toCsv([
      ["section", "item", "amount"],
      ["Revenue (cash received)", "Payments received", money(summary.revenue.receivedCents)],
      ...summary.revenue.byProject.map((r) => ["Revenue by project", r.project, money(r.cents)]),
      ["Reference", "Invoiced (accrual reference)", money(summary.revenue.invoicedCents)],
      ...summary.lines.filter((l) => l.costOfGoodsSold).map((l) => ["Cost of goods sold", `${l.label} (${l.formLine ?? ""})`, money(l.deductibleCents)]),
      ["Cost of goods sold", "Subtotal", money(summary.cogsCents)],
      ...summary.lines.filter((l) => !l.costOfGoodsSold && !l.capitalize).map((l) => ["Deductions", `${l.label} (${l.formLine ?? ""})`, money(l.deductibleCents)]),
      ["Deductions", "Subtotal", money(summary.deductionsCents)],
      ["Net profit (estimate)", "Revenue − COGS − deductions", money(summary.netProfitCents)],
      ...summary.capitalPurchases.map((c) => ["Capital purchases (not deducted above)", `${c.spentOn} ${c.vendorName}`, money(c.amountCents)]),
      ["Memo", "Sales tax paid (included in expense totals)", money(summary.salesTaxPaidCents)],
    ]),
  );

  put(
    "deductions_by_tax_line.csv",
    toCsv([
      ["category", "form_line", "cost_of_goods_sold", "capitalize", "count", "amount", "deductible", "missing_receipts"],
      ...summary.lines.map((l) => [l.label, l.formLine ?? "", l.costOfGoodsSold ? "yes" : "no", l.capitalize ? "yes" : "no", l.count, money(l.amountCents), money(l.deductibleCents), l.missingReceipts]),
    ]),
  );

  const expenses = await yearExpenses(tx, orgId, year);
  const receiptName = (e: (typeof expenses)[number]) => {
    if (!e.receipt) return "";
    const ext = e.receipt.storageKey.split(".").pop() ?? "jpg";
    return `receipts/${fromDbDate(e.spentOn)}_${safe(e.vendorName)}_${e.id.slice(0, 8)}.${ext}`;
  };
  put(
    "expenses_detail.csv",
    toCsv([
      ["date", "vendor", "project", "amount", "sales_tax", "tax_category", "form_line", "deductible", "job_cost_category", "paid_by", "payment_method", "status", "note", "receipt_file"],
      ...expenses.map((e) => [
        fromDbDate(e.spentOn),
        e.vendorName,
        e.project?.name ?? "Company overhead",
        money(e.amountCents),
        money(e.salesTaxCents),
        taxCategoryById(e.taxCategory)?.label ?? e.taxCategory,
        lineOf(e.taxCategory) ?? "",
        money(deductibleCents(e.taxCategory, e.amountCents)),
        e.category,
        e.paidBy,
        e.paymentMethod ?? "",
        e.status,
        e.note ?? "",
        receiptName(e),
      ]),
    ]),
  );
  for (const e of expenses) {
    if (!e.receipt) continue;
    try {
      files[receiptName(e)] = new Uint8Array(await storage.read(e.receipt.storageKey));
    } catch {
      // Missing file on disk: the CSV still lists it; skip the image.
    }
  }

  const v1099 = await vendors1099(tx, orgId, year);
  put(
    "form_1099_nec.csv",
    toCsv([
      ["vendor", "status", "box1_nonemployee_comp", "card_payments_excluded", "tax_classification", "w9_on_file", "tin_last4", "address", "email", "issues"],
      ...v1099.map((r) => [
        r.vendor.name,
        r.status,
        money(r.reportableCents),
        money(r.excludedCardCents),
        r.vendor.taxClassification ? VENDOR_TAX_CLASS_LABELS[r.vendor.taxClassification as VendorTaxClass] : "unknown",
        r.vendor.w9OnFile ? "yes" : "no",
        r.vendor.tinLast4 ? `***-**-${r.vendor.tinLast4}` : "",
        r.vendor.address ?? "",
        r.vendor.email ?? "",
        r.issues.join("; "),
      ]),
    ]),
  );

  const sheets = await tx.timesheet.findMany({
    where: { orgId, status: { in: ["APPROVED", "EXPORTED", "PAID"] }, payPeriod: { endDate: { gte: new Date(`${year}-01-01`), lt: new Date(`${year + 1}-01-01`) } } },
    include: { user: true, payPeriod: true },
  });
  const profiles = new Map((await tx.workerProfile.findMany({ where: { orgId } })).map((p) => [p.userId, p.classification]));
  const byWorker = new Map<string, { name: string; email: string; cls: string; reg: number; ot: number; dt: number; gross: number; paid: number }>();
  for (const s of sheets) {
    const w = byWorker.get(s.userId) ?? { name: s.user.name, email: s.user.email, cls: profiles.get(s.userId) ?? "W2", reg: 0, ot: 0, dt: 0, gross: 0, paid: 0 };
    w.reg += s.regularMinutes ?? 0;
    w.ot += s.overtimeMinutes ?? 0;
    w.dt += s.doubleTimeMinutes ?? 0;
    w.gross += s.grossCents ?? 0;
    if (s.status === "PAID") w.paid += s.grossCents ?? 0;
    byWorker.set(s.userId, w);
  }
  put(
    "payroll_summary.csv",
    toCsv([
      ["worker", "email", "classification", "regular_hours", "overtime_hours", "double_time_hours", "gross_wages_estimate", "of_which_marked_paid"],
      ...[...byWorker.values()].map((w) => [w.name, w.email, w.cls, minutesToHours(w.reg), minutesToHours(w.ot), minutesToHours(w.dt), money(w.gross), money(w.paid)]),
    ]),
  );

  const projects = await tx.project.findMany({ where: { orgId, status: { not: "CANCELLED" } }, select: { id: true } });
  const jc = [];
  for (const p of projects) jc.push(await projectJobCost(tx, orgId, p.id));
  put(
    "job_cost_summary.csv",
    toCsv([
      ["project", "type", "contract_type", "status", "percent_complete", "revenue", "cost_to_date", "estimate_at_completion", "projected_profit", "received"],
      ...jc.map((j) => [j.project.name, j.project.projectType ?? "", j.project.contractType, j.project.status, Math.round(j.percentComplete * 100), money(j.revenueCents), money(j.totalActualCents), money(j.estimateAtCompletionCents), money(j.projectedProfitCents), money(j.receivedCents)]),
    ]),
  );

  const miles = await tx.mileageLog.findMany({
    where: { orgId, date: { gte: new Date(`${year}-01-01`), lt: new Date(`${year + 1}-01-01`) } },
    include: { user: { select: { name: true } }, project: { select: { name: true } } },
    orderBy: { date: "asc" },
  });
  put(
    "mileage_log.csv",
    toCsv([
      ["date", "driver", "miles", "purpose", "from", "to", "project", "deduction_at_standard_rate"],
      ...miles.map((m) => [fromDbDate(m.date), m.user.name, m.miles, m.purpose, m.fromPlace ?? "", m.toPlace ?? "", m.project?.name ?? "", money(Math.round((m.miles * summary.mileage.rateMilliCents) / 100))]),
    ]),
  );

  const est = await estimates(tx, orgId, year);
  put(
    "estimated_tax_payments.csv",
    toCsv([["quarter", "paid_on", "amount", "note"], ...est.payments.map((p) => [`Q${p.quarter}`, p.paidOn, money(p.amountCents), p.note ?? ""])]),
  );

  files["README.txt"] = strToU8(
    [
      `${org.name}: ${year} tax-prep package`,
      `Generated ${new Date().toISOString()} by Timepeace.`,
      "",
      `Entity type: ${org.entityType}. Line references: ${form === "scheduleC" ? "Schedule C (Form 1040)" : form === "form1120S" ? "Form 1120-S / Form 1125-A" : "not mapped for this entity type"}.`,
      "Basis: cash. Revenue = customer payments received in the year; expenses by date spent.",
      "Wages are estimates from approved timesheets (pay periods ending in the year). Use your payroll provider's",
      "annual reports (W-2/W-3, 941/940) for wages and employer payroll taxes, which are not included here.",
      "Meals are shown at 50% deductible. Capital purchases are listed separately for depreciation / §179 decisions.",
      "1099-NEC: card/third-party-network payments are excluded (reported on 1099-K). Corporations are treated as exempt",
      "except attorneys. Review every vendor's W-9 classification. TINs are not included; only the last 4 digits.",
      "",
      "Flags:",
      ...summary.flags.map((f) => `- ${f.message}`),
      "",
      "This package organizes records for a tax professional. It is not tax advice and has not been filed.",
    ].join("\n"),
  );

  return { filename: `${safe(org.name)}_${year}_tax_package.zip`, data: zipSync(files, { level: 6 }) };
}
