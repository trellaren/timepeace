import type { ContractType, CostCategory, TaskStatus } from "./enums";
import { COMPLETED_TASK_STATUSES } from "./enums";
import { applyBps, minutesToCost, type Cents } from "./money";

/** Fully-burdened labor cost: base wage × (1 + burden) where burden covers payroll taxes, workers' comp, benefits. */
export function laborCostCents(minutes: number, hourlyRateCents: Cents, burdenBps: number): Cents {
  const base = minutesToCost(minutes, hourlyRateCents);
  return base + applyBps(base, burdenBps);
}

export interface TaskProgressInput {
  status: TaskStatus;
  estimatedMinutes: number | null;
}

/** Percent complete (0..1), weighted by estimated hours; falls back to task count when no estimates exist. */
export function percentComplete(tasks: TaskProgressInput[]): number {
  if (tasks.length === 0) return 0;
  const totalEst = tasks.reduce((a, t) => a + (t.estimatedMinutes ?? 0), 0);
  const done = (t: TaskProgressInput) => COMPLETED_TASK_STATUSES.includes(t.status);
  if (totalEst > 0) {
    return tasks.filter(done).reduce((a, t) => a + (t.estimatedMinutes ?? 0), 0) / totalEst;
  }
  return tasks.filter(done).length / tasks.length;
}

export interface BudgetLineInput {
  costCodeId: string;
  costCodeLabel: string;
  category: CostCategory;
  budgetCents: Cents;
}

export interface ActualCostInput {
  costCodeId: string | null;
  category: CostCategory;
  amountCents: Cents;
}

export type BudgetAlert = "OK" | "WARNING" | "OVER";

export interface JobCostLine {
  key: string;
  costCodeId: string | null;
  costCodeLabel: string;
  category: CostCategory;
  budgetCents: Cents;
  actualCents: Cents;
  varianceCents: Cents;
  /** actual / budget, or null when there's no budget. */
  pctSpent: number | null;
  alert: BudgetAlert;
}

export interface JobCostSummary {
  lines: JobCostLine[];
  contractValueCents: Cents;
  approvedChangeOrdersCents: Cents;
  revenueCents: Cents;
  totalBudgetCents: Cents;
  totalActualCents: Cents;
  percentComplete: number;
  /** Projected total cost at completion based on cost performance to date. */
  estimateAtCompletionCents: Cents;
  projectedProfitCents: Cents;
  /** Projected profit / revenue, in basis points. */
  projectedMarginBps: number | null;
  /** Revenue earned to date (revenue × % complete) minus cost to date. */
  earnedProfitCents: Cents;
  byCategory: Record<CostCategory, { budgetCents: Cents; actualCents: Cents }>;
}

export const WARNING_THRESHOLD = 0.8;

export function budgetAlert(budget: Cents, actual: Cents): BudgetAlert {
  if (budget <= 0) return actual > 0 ? "OVER" : "OK";
  const r = actual / budget;
  if (r >= 1) return "OVER";
  if (r >= WARNING_THRESHOLD) return "WARNING";
  return "OK";
}

/**
 * Fixed-price jobs earn the contract value (+ approved change orders) regardless of cost.
 * Cost-plus and T&M jobs bill cost × (1 + markup); their contract value is only an estimate, so
 * revenue is projected from the estimate at completion.
 */
export function computeJobCost(input: {
  contractType?: ContractType;
  markupBps?: number | null;
  contractValueCents: Cents;
  approvedChangeOrdersCents: Cents;
  budgetLines: BudgetLineInput[];
  actuals: ActualCostInput[];
  percentComplete: number;
  /** Label for actuals that have no cost code. */
  uncodedLabel?: string;
}): JobCostSummary {
  const lineKey = (costCodeId: string | null, cat: CostCategory) => `${costCodeId ?? "_"}:${cat}`;
  const lines = new Map<string, JobCostLine>();

  for (const b of input.budgetLines) {
    const key = lineKey(b.costCodeId, b.category);
    const existing = lines.get(key);
    if (existing) {
      existing.budgetCents += b.budgetCents;
    } else {
      lines.set(key, {
        key,
        costCodeId: b.costCodeId,
        costCodeLabel: b.costCodeLabel,
        category: b.category,
        budgetCents: b.budgetCents,
        actualCents: 0,
        varianceCents: 0,
        pctSpent: null,
        alert: "OK",
      });
    }
  }

  for (const a of input.actuals) {
    const key = lineKey(a.costCodeId, a.category);
    let line = lines.get(key);
    if (!line) {
      const label =
        input.budgetLines.find((b) => b.costCodeId === a.costCodeId)?.costCodeLabel ??
        input.uncodedLabel ??
        "Uncoded";
      line = {
        key,
        costCodeId: a.costCodeId,
        costCodeLabel: label,
        category: a.category,
        budgetCents: 0,
        actualCents: 0,
        varianceCents: 0,
        pctSpent: null,
        alert: "OK",
      };
      lines.set(key, line);
    }
    line.actualCents += a.amountCents;
  }

  const byCategory = {
    LABOR: { budgetCents: 0, actualCents: 0 },
    MATERIAL: { budgetCents: 0, actualCents: 0 },
    SUB: { budgetCents: 0, actualCents: 0 },
    EQUIPMENT: { budgetCents: 0, actualCents: 0 },
    OTHER: { budgetCents: 0, actualCents: 0 },
  } satisfies JobCostSummary["byCategory"];

  for (const l of lines.values()) {
    l.varianceCents = l.budgetCents - l.actualCents;
    l.pctSpent = l.budgetCents > 0 ? l.actualCents / l.budgetCents : null;
    l.alert = budgetAlert(l.budgetCents, l.actualCents);
    byCategory[l.category].budgetCents += l.budgetCents;
    byCategory[l.category].actualCents += l.actualCents;
  }

  const sorted = [...lines.values()].sort(
    (a, b) => a.costCodeLabel.localeCompare(b.costCodeLabel) || a.category.localeCompare(b.category),
  );
  const totalBudgetCents = sorted.reduce((a, l) => a + l.budgetCents, 0);
  const totalActualCents = sorted.reduce((a, l) => a + l.actualCents, 0);
  const pct = Math.min(1, Math.max(0, input.percentComplete));

  // Below 5% complete, cost-performance extrapolation is noise; trust the budget.
  const estimateAtCompletionCents =
    pct >= 0.05 ? Math.max(totalActualCents, Math.round(totalActualCents / pct)) : Math.max(totalBudgetCents, totalActualCents);

  const billsOnCost = input.contractType === "COST_PLUS" || input.contractType === "T_AND_M";
  const markup = 1 + (input.markupBps ?? 0) / 10_000;
  const revenueCents = billsOnCost
    ? Math.round(estimateAtCompletionCents * markup)
    : input.contractValueCents + input.approvedChangeOrdersCents;
  const earnedRevenueCents = billsOnCost ? Math.round(totalActualCents * markup) : Math.round(revenueCents * pct);
  const projectedProfitCents = revenueCents - estimateAtCompletionCents;

  return {
    lines: sorted,
    contractValueCents: input.contractValueCents,
    approvedChangeOrdersCents: input.approvedChangeOrdersCents,
    revenueCents,
    totalBudgetCents,
    totalActualCents,
    percentComplete: pct,
    estimateAtCompletionCents,
    projectedProfitCents,
    projectedMarginBps: revenueCents > 0 ? Math.round((projectedProfitCents / revenueCents) * 10_000) : null,
    earnedProfitCents: earnedRevenueCents - totalActualCents,
    byCategory,
  };
}
