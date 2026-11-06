import { describe, expect, it } from "vitest";
import { deductibleCents, taxFormFor } from "../tax";
import { estimatedTaxWorksheet, evaluate1099, type Vendor1099Input } from "../taxPrep";

const sole: Vendor1099Input = { is1099Eligible: true, w9OnFile: true, tinOnFile: true, taxClassification: "INDIVIDUAL", isAttorney: false };
const T = 200_000; // $2,000

describe("evaluate1099", () => {
  it("files for a sole proprietor paid ≥ threshold by check", () => {
    const r = evaluate1099(sole, [{ amountCents: 150_000, method: "CHECK", source: "EXPENSE" }, { amountCents: 60_000, method: "ACH", source: "EXPENSE" }], T);
    expect(r).toMatchObject({ status: "FILE", reportableCents: 210_000, issues: [] });
  });
  it("excludes card payments (reported on 1099-K)", () => {
    const r = evaluate1099(sole, [{ amountCents: 150_000, method: "CHECK", source: "EXPENSE" }, { amountCents: 100_000, method: "CARD", source: "EXPENSE" }], T);
    expect(r).toMatchObject({ status: "BELOW_THRESHOLD", reportableCents: 150_000, excludedCardCents: 100_000 });
  });
  it("exempts corporations but not attorneys", () => {
    const pay = [{ amountCents: 500_000, method: "CHECK" as const, source: "EXPENSE" as const }];
    expect(evaluate1099({ ...sole, taxClassification: "S_CORP" }, pay, T).status).toBe("EXEMPT_CORPORATION");
    expect(evaluate1099({ ...sole, taxClassification: "LLC_C" }, pay, T).status).toBe("EXEMPT_CORPORATION");
    expect(evaluate1099({ ...sole, taxClassification: "C_CORP", isAttorney: true }, pay, T).status).toBe("FILE");
  });
  it("treats unknown classification and unknown method as reportable, with issues", () => {
    const r = evaluate1099({ ...sole, w9OnFile: false, tinOnFile: false, taxClassification: null }, [{ amountCents: 300_000, method: null, source: "EXPENSE" }], T);
    expect(r.status).toBe("FILE");
    expect(r.unknownMethodCents).toBe(300_000);
    expect(r.issues.join(" ")).toMatch(/W-9.*classification.*method/s);
  });
  it("ignores goods-only vendors", () => {
    expect(evaluate1099({ ...sole, is1099Eligible: false }, [{ amountCents: 900_000, method: "CHECK", source: "EXPENSE" }], T).status).toBe("NOT_SERVICE_VENDOR");
  });
  it("notes contractors paid through payroll", () => {
    const r = evaluate1099(sole, [{ amountCents: 250_000, method: "ACH", source: "PAYROLL" }], T);
    expect(r.payrollCents).toBe(250_000);
    expect(r.issues.join()).toMatch(/payroll provider/);
  });
});

describe("deductibleCents / taxFormFor", () => {
  it("limits meals to 50% and excludes capital purchases", () => {
    expect(deductibleCents("meals", 10_001)).toBe(5001);
    expect(deductibleCents("equipment_purchase", 189_900)).toBe(0);
    expect(deductibleCents("job_materials", 1234)).toBe(1234);
  });
  it("maps entity types to forms", () => {
    expect(taxFormFor("LLC_SINGLE")).toBe("scheduleC");
    expect(taxFormFor("S_CORP")).toBe("form1120S");
    expect(taxFormFor("PARTNERSHIP")).toBe("other");
  });
});

describe("estimatedTaxWorksheet", () => {
  const base = { year: 2026, effectiveRateBps: 2500, priorYearTaxCents: null, priorYearAgiOver150k: false, payments: [] };
  it("annualizes YTD profit and requires 90% of projected tax in four installments", () => {
    // 2026-07-02 is day 183 of 365 → ~50.1%
    const r = estimatedTaxWorksheet({ ...base, asOf: "2026-07-02", ytdNetProfitCents: 100_000_00 });
    expect(r.yearFraction).toBeCloseTo(183 / 365, 6);
    expect(r.projectedAnnualProfitCents).toBe(Math.round(100_000_00 / (183 / 365)));
    expect(r.method).toBe("CURRENT_YEAR_90");
    expect(r.requiredAnnualCents).toBe(Math.round(r.projectedTaxCents * 0.9));
    expect(r.quarters.map((q) => q.dueDate)).toEqual(["2026-04-15", "2026-06-15", "2026-09-15", "2027-01-15"]);
    expect(r.quarters.map((q) => q.status)).toEqual(["SHORT", "SHORT", "UPCOMING", "UPCOMING"]);
  });
  it("uses the prior-year safe harbor (110% when AGI > $150k) when lower, and tracks payments", () => {
    const r = estimatedTaxWorksheet({ ...base, asOf: "2026-09-01", ytdNetProfitCents: 300_000_00, priorYearTaxCents: 40_000_00, priorYearAgiOver150k: true, payments: [{ quarter: 1, amountCents: 11_000_00 }, { quarter: 2, amountCents: 11_000_00 }] });
    expect(r.method).toBe("PRIOR_YEAR_SAFE_HARBOR");
    expect(r.requiredAnnualCents).toBe(44_000_00);
    expect(r.quarters.map((q) => q.status)).toEqual(["PAID", "PAID", "DUE_SOON", "UPCOMING"]);
  });
  it("never goes negative on a loss", () => {
    expect(estimatedTaxWorksheet({ ...base, asOf: "2026-05-01", ytdNetProfitCents: -5_000_00 }).requiredAnnualCents).toBe(0);
  });
});
