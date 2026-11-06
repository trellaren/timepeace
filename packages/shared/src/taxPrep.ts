/**
 * Tax-prep helpers: 1099-NEC evaluation and the quarterly estimated-tax worksheet.
 * These organize records for a tax professional. They are not tax advice and don't file anything.
 */
import { addDays, localDateToDayNumber, type LocalDate } from "./time";

export const VENDOR_TAX_CLASSES = ["INDIVIDUAL", "PARTNERSHIP", "C_CORP", "S_CORP", "LLC_C", "LLC_S", "LLC_P", "TRUST_ESTATE", "OTHER"] as const;
export type VendorTaxClass = (typeof VENDOR_TAX_CLASSES)[number];
export const VENDOR_TAX_CLASS_LABELS: Record<VendorTaxClass, string> = {
  INDIVIDUAL: "Individual / sole proprietor / single-member LLC",
  PARTNERSHIP: "Partnership",
  C_CORP: "C corporation",
  S_CORP: "S corporation",
  LLC_C: "LLC taxed as C corp",
  LLC_S: "LLC taxed as S corp",
  LLC_P: "LLC taxed as partnership",
  TRUST_ESTATE: "Trust / estate",
  OTHER: "Other",
};
/** Payments to corporations are generally exempt from 1099-NEC, except attorneys' fees. */
export const CORPORATE_TAX_CLASSES: readonly VendorTaxClass[] = ["C_CORP", "S_CORP", "LLC_C", "LLC_S"];

export const PAYMENT_METHODS = ["CHECK", "ACH", "CASH", "CARD"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface Vendor1099Input {
  is1099Eligible: boolean;
  w9OnFile: boolean;
  tinOnFile: boolean;
  taxClassification: VendorTaxClass | null;
  isAttorney: boolean;
}

export interface Payment1099 {
  amountCents: number;
  /** null = not recorded. */
  method: PaymentMethod | null;
  /** PAYROLL = contractor paid through the payroll provider (it may file the 1099 itself). */
  source: "EXPENSE" | "PAYROLL";
}

export type Form1099Status = "FILE" | "BELOW_THRESHOLD" | "EXEMPT_CORPORATION" | "NOT_SERVICE_VENDOR";

export interface Form1099Result {
  status: Form1099Status;
  /** Box 1 amount: non-card payments for services (incl. parts/materials provided with the service). */
  reportableCents: number;
  /** Card / third-party-network payments: reported by the processor on 1099-K, not by you. */
  excludedCardCents: number;
  /** Included in reportableCents but the payment method wasn't recorded. */
  unknownMethodCents: number;
  payrollCents: number;
  issues: string[];
}

export function evaluate1099(v: Vendor1099Input, payments: Payment1099[], thresholdCents: number): Form1099Result {
  const card = payments.filter((p) => p.method === "CARD");
  const counted = payments.filter((p) => p.method !== "CARD");
  const sum = (ps: Payment1099[]) => ps.reduce((a, p) => a + p.amountCents, 0);
  const reportableCents = sum(counted);
  const unknownMethodCents = sum(counted.filter((p) => p.method == null && p.source === "EXPENSE"));
  const payrollCents = sum(counted.filter((p) => p.source === "PAYROLL"));
  const issues: string[] = [];

  let status: Form1099Status;
  if (!v.is1099Eligible) status = "NOT_SERVICE_VENDOR";
  else if (v.taxClassification && CORPORATE_TAX_CLASSES.includes(v.taxClassification) && !v.isAttorney) status = "EXEMPT_CORPORATION";
  else status = reportableCents >= thresholdCents ? "FILE" : "BELOW_THRESHOLD";

  if (status === "FILE" || status === "BELOW_THRESHOLD") {
    const relevant = status === "FILE" || reportableCents >= thresholdCents * 0.75;
    if (!v.w9OnFile) issues.push(relevant ? "Request a W-9 before year end" : "No W-9 on file");
    else if (!v.tinOnFile && relevant) issues.push("W-9 on file but TIN not entered");
    if (!v.taxClassification) issues.push("Tax classification unknown (from W-9 line 3). Treated as reportable");
    if (unknownMethodCents > 0) issues.push("Some payments have no payment method recorded. Card payments are excluded, so confirm");
    if (payrollCents > 0) issues.push("Paid through your payroll provider: check whether it files this 1099-NEC for you");
  }
  return { status, reportableCents, excludedCardCents: sum(card), unknownMethodCents, payrollCents, issues };
}

/* ───────────── Quarterly estimated tax ───────────── */

/** IRS due dates for estimated payments (moved to the next business day if they fall on a weekend or holiday). */
export function estimatedTaxDueDates(year: number): [LocalDate, LocalDate, LocalDate, LocalDate] {
  return [`${year}-04-15`, `${year}-06-15`, `${year}-09-15`, `${year + 1}-01-15`];
}

export interface EstimateInput {
  year: number;
  asOf: LocalDate;
  ytdNetProfitCents: number;
  /** Combined effective rate (income + self-employment tax) agreed with your CPA, in bps. */
  effectiveRateBps: number;
  priorYearTaxCents: number | null;
  /** Prior-year AGI over $150k (or $75k MFS) → safe harbor is 110% instead of 100%. */
  priorYearAgiOver150k: boolean;
  payments: { quarter: 1 | 2 | 3 | 4; amountCents: number }[];
}

export type QuarterStatus = "PAID" | "SHORT" | "DUE_SOON" | "UPCOMING";

export interface EstimateResult {
  /** Fraction of the year elapsed used to annualize. */
  yearFraction: number;
  projectedAnnualProfitCents: number;
  projectedTaxCents: number;
  methods: { current90: number; priorYearSafeHarbor: number | null };
  method: "CURRENT_YEAR_90" | "PRIOR_YEAR_SAFE_HARBOR";
  requiredAnnualCents: number;
  quarters: {
    quarter: 1 | 2 | 3 | 4;
    dueDate: LocalDate;
    installmentCents: number;
    paidCents: number;
    cumulativeRequiredCents: number;
    cumulativePaidCents: number;
    status: QuarterStatus;
  }[];
}

export function estimatedTaxWorksheet(i: EstimateInput): EstimateResult {
  const jan1 = localDateToDayNumber(`${i.year}-01-01`);
  const daysInYear = localDateToDayNumber(`${i.year + 1}-01-01`) - jan1;
  const elapsed = Math.min(daysInYear, Math.max(1, localDateToDayNumber(i.asOf) - jan1 + 1));
  const yearFraction = elapsed / daysInYear;
  const projectedAnnualProfitCents = Math.round(i.ytdNetProfitCents / yearFraction);
  const projectedTaxCents = Math.max(0, Math.round((projectedAnnualProfitCents * i.effectiveRateBps) / 10_000));
  const current90 = Math.round(projectedTaxCents * 0.9);
  const priorYearSafeHarbor = i.priorYearTaxCents == null ? null : Math.round(i.priorYearTaxCents * (i.priorYearAgiOver150k ? 1.1 : 1));
  const useSafeHarbor = priorYearSafeHarbor != null && priorYearSafeHarbor < current90;
  const requiredAnnualCents = useSafeHarbor ? priorYearSafeHarbor! : current90;

  const due = estimatedTaxDueDates(i.year);
  let cumulativePaid = 0;
  const quarters = ([1, 2, 3, 4] as const).map((q) => {
    const paidCents = i.payments.filter((p) => p.quarter === q).reduce((a, p) => a + p.amountCents, 0);
    cumulativePaid += paidCents;
    const cumulativeRequiredCents = Math.round((requiredAnnualCents * q) / 4);
    const dueDate = due[q - 1]!;
    const passed = i.asOf > dueDate;
    const soon = !passed && i.asOf >= addDays(dueDate, -30);
    const status: QuarterStatus = cumulativePaid >= cumulativeRequiredCents ? "PAID" : passed ? "SHORT" : soon ? "DUE_SOON" : "UPCOMING";
    return {
      quarter: q,
      dueDate,
      installmentCents: Math.round(requiredAnnualCents / 4),
      paidCents,
      cumulativeRequiredCents,
      cumulativePaidCents: cumulativePaid,
      status,
    };
  });

  return {
    yearFraction,
    projectedAnnualProfitCents,
    projectedTaxCents,
    methods: { current90, priorYearSafeHarbor },
    method: useSafeHarbor ? "PRIOR_YEAR_SAFE_HARBOR" : "CURRENT_YEAR_90",
    requiredAnnualCents,
    quarters,
  };
}
