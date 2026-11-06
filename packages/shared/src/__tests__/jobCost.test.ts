import { describe, expect, it } from "vitest";
import { budgetAlert, computeJobCost, laborCostCents, percentComplete } from "../jobCost";

describe("laborCostCents", () => {
  it("applies the burden rate to base wages", () => {
    // 8h at $30/h = $240; +25% burden = $300
    expect(laborCostCents(480, 3000, 2500)).toBe(30000);
  });
  it("rounds to the cent", () => {
    // 7 minutes at $31.33/h = 365.5¢ → 366¢; burden 0
    expect(laborCostCents(7, 3133, 0)).toBe(366);
  });
});

describe("percentComplete", () => {
  it("weights by estimated minutes", () => {
    expect(
      percentComplete([
        { status: "DONE", estimatedMinutes: 300 },
        { status: "TODO", estimatedMinutes: 100 },
      ]),
    ).toBe(0.75);
  });
  it("falls back to task count", () => {
    expect(
      percentComplete([
        { status: "VERIFIED", estimatedMinutes: null },
        { status: "IN_PROGRESS", estimatedMinutes: null },
      ]),
    ).toBe(0.5);
  });
  it("is zero with no tasks", () => expect(percentComplete([])).toBe(0));
});

describe("budgetAlert", () => {
  it("flags 80% and 100%", () => {
    expect(budgetAlert(1000, 799)).toBe("OK");
    expect(budgetAlert(1000, 800)).toBe("WARNING");
    expect(budgetAlert(1000, 1000)).toBe("OVER");
    expect(budgetAlert(0, 1)).toBe("OVER");
  });
});

describe("computeJobCost", () => {
  const base = {
    contractValueCents: 100_000_00,
    approvedChangeOrdersCents: 5_000_00,
    budgetLines: [
      { costCodeId: "framing", costCodeLabel: "06 Framing", category: "LABOR" as const, budgetCents: 20_000_00 },
      { costCodeId: "framing", costCodeLabel: "06 Framing", category: "MATERIAL" as const, budgetCents: 30_000_00 },
      { costCodeId: "elec", costCodeLabel: "16 Electrical", category: "SUB" as const, budgetCents: 30_000_00 },
    ],
  };

  it("rolls up actuals against budget lines and projects margin", () => {
    const r = computeJobCost({
      ...base,
      actuals: [
        { costCodeId: "framing", category: "LABOR", amountCents: 18_000_00 },
        { costCodeId: "framing", category: "MATERIAL", amountCents: 12_000_00 },
        { costCodeId: null, category: "OTHER", amountCents: 1_000_00 },
      ],
      percentComplete: 0.4,
    });
    expect(r.revenueCents).toBe(105_000_00);
    expect(r.totalBudgetCents).toBe(80_000_00);
    expect(r.totalActualCents).toBe(31_000_00);
    expect(r.estimateAtCompletionCents).toBe(77_500_00);
    expect(r.projectedProfitCents).toBe(27_500_00);
    expect(r.projectedMarginBps).toBe(2619);
    expect(r.earnedProfitCents).toBe(42_000_00 - 31_000_00);
    const labor = r.lines.find((l) => l.key === "framing:LABOR")!;
    expect(labor).toMatchObject({ alert: "WARNING", varianceCents: 2_000_00, pctSpent: 0.9 });
    const uncoded = r.lines.find((l) => l.costCodeId === null)!;
    expect(uncoded).toMatchObject({ costCodeLabel: "Uncoded", budgetCents: 0, alert: "OVER" });
    expect(r.byCategory.MATERIAL).toEqual({ budgetCents: 30_000_00, actualCents: 12_000_00 });
  });

  it("uses budget as EAC early in a job", () => {
    const r = computeJobCost({ ...base, actuals: [{ costCodeId: "elec", category: "SUB", amountCents: 100_00 }], percentComplete: 0.01 });
    expect(r.estimateAtCompletionCents).toBe(80_000_00);
  });

  it("cost-plus revenue follows cost × (1 + markup)", () => {
    const r = computeJobCost({
      ...base,
      contractType: "COST_PLUS",
      markupBps: 1500,
      actuals: [{ costCodeId: "framing", category: "LABOR", amountCents: 10_000_00 }],
      percentComplete: 0.5,
    });
    expect(r.estimateAtCompletionCents).toBe(20_000_00);
    expect(r.revenueCents).toBe(23_000_00);
    expect(r.projectedProfitCents).toBe(3_000_00);
    expect(r.projectedMarginBps).toBe(1304);
    expect(r.earnedProfitCents).toBe(1_500_00);
  });
});
