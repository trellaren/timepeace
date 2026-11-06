import { fromDbDate } from "@timepeace/db";
import {
  DEFAULT_MIN_UNPAID_BREAK_MINUTES,
  paidShiftMinutes,
  computeJobCost,
  laborCostCents,
  minutesBetween,
  percentComplete,
  toLocalDate,
  type ActualCostInput,
  type CostCategory,
} from "@timepeace/shared";
import type { Tx } from "../lib/db";
import { overtimeRules } from "./org";
import { rateLookup } from "./timesheet";

type LaborActual = ActualCostInput & { projectId: string; taskId: string | null; minutes: number; unallocated: boolean };

/**
 * Fully-burdened labor cost, using the pay rate in effect on the work date.
 * - Task time entries are charged to their task's cost code.
 * - Paid shift time NOT on any task (travel, setup, cleanup, waiting) is still a real cost: it's
 *   charged to the job the worker clocked into (uncoded), or reported as company overhead.
 */
export async function laborActuals(tx: Tx, orgId: string, where: { projectId?: string }) {
  const org = await tx.organization.findUniqueOrThrow({ where: { id: orgId } });
  const minUnpaidBreakMinutes = overtimeRules(org).minUnpaidBreakMinutes ?? DEFAULT_MIN_UNPAID_BREAK_MINUTES;
  const entries = await tx.timeEntry.findMany({
    where: { orgId, endedAt: { not: null }, ...where },
    include: { task: { select: { costCodeId: true } } },
  });
  const shifts = await tx.shift.findMany({
    where: { orgId, clockOutAt: { not: null }, ...(where.projectId ? { projectId: where.projectId } : {}) },
    include: { breaks: true, timeEntries: { where: { endedAt: { not: null } } } },
  });

  const lookups = new Map<string, Awaited<ReturnType<typeof rateLookup>>>();
  const lookup = async (userId: string) => {
    let l = lookups.get(userId);
    if (!l) {
      l = await rateLookup(tx, orgId, userId);
      lookups.set(userId, l);
    }
    const contractor = l.profile?.classification === "CONTRACTOR_1099";
    return { rateFor: l.rateFor, contractor, burden: contractor ? 0 : (l.profile?.burdenBps ?? org.defaultBurdenBps) };
  };
  const cost = async (userId: string, minutes: number, at: Date) => {
    const l = await lookup(userId);
    return {
      // 1099 hourly work is subcontract cost, not payroll labor.
      category: (l.contractor ? "SUB" : "LABOR") as CostCategory,
      amountCents: laborCostCents(minutes, l.rateFor(toLocalDate(at, org.timezone)), l.burden),
    };
  };

  const actuals: LaborActual[] = [];
  for (const e of entries) {
    const minutes = Math.max(0, minutesBetween(e.startedAt, e.endedAt!) - e.breakMinutes);
    actuals.push({ projectId: e.projectId, taskId: e.taskId, costCodeId: e.task?.costCodeId ?? null, minutes, unallocated: false, ...(await cost(e.userId, minutes, e.startedAt)) });
  }
  const overhead = { minutes: 0, cents: 0 };
  for (const sh of shifts) {
    const paid = paidShiftMinutes(sh, { minUnpaidBreakMinutes });
    const allocated = sh.timeEntries.reduce((a, e) => a + Math.max(0, minutesBetween(e.startedAt, e.endedAt!) - e.breakMinutes), 0);
    const minutes = Math.max(0, paid - allocated);
    if (minutes === 0) continue;
    const c = await cost(sh.userId, minutes, sh.clockInAt);
    if (sh.projectId) actuals.push({ projectId: sh.projectId, taskId: null, costCodeId: null, minutes, unallocated: true, ...c });
    else {
      overhead.minutes += minutes;
      overhead.cents += c.amountCents;
    }
  }
  return { actuals, overhead };
}

export async function projectJobCost(tx: Tx, orgId: string, projectId: string) {
  const project = await tx.project.findFirstOrThrow({
    where: { id: projectId, orgId },
    include: {
      budgetLines: { include: { costCode: true } },
      changeOrders: { where: { status: "APPROVED" } },
      tasks: { select: { status: true, estimatedMinutes: true } },
      expenses: { where: { status: { not: "REJECTED" } }, include: { costCode: true } },
      invoices: { include: { payments: true } },
    },
  });
  const { actuals: labor } = await laborActuals(tx, orgId, { projectId });
  const coCost = project.changeOrders.reduce((a, c) => a + c.costImpactCents, 0);
  const summary = computeJobCost({
    contractType: project.contractType,
    markupBps: project.markupBps,
    contractValueCents: project.contractValueCents,
    approvedChangeOrdersCents: project.changeOrders.reduce((a, c) => a + c.amountCents, 0),
    budgetLines: [
      ...project.budgetLines.map((b) => ({
        costCodeId: b.costCodeId,
        costCodeLabel: `${b.costCode.code} ${b.costCode.name}`,
        category: b.category as CostCategory,
        budgetCents: b.amountCents,
      })),
      ...(coCost > 0 ? [{ costCodeId: "_co", costCodeLabel: "Approved change orders", category: "OTHER" as const, budgetCents: coCost }] : []),
    ],
    actuals: [
      ...labor,
      ...project.expenses.map((e) => ({ costCodeId: e.costCodeId, category: e.category as CostCategory, amountCents: e.amountCents })),
    ],
    percentComplete: percentComplete(project.tasks),
    uncodedLabel: "Crew time not on a task / uncoded",
  });
  const invoicedCents = project.invoices.filter((i) => i.status !== "VOID").reduce((a, i) => a + i.amountCents, 0);
  const receivedCents = project.invoices.flatMap((i) => i.payments).reduce((a, p) => a + p.amountCents, 0);
  return {
    project: { id: project.id, name: project.name, status: project.status, projectType: project.projectType, contractType: project.contractType },
    laborMinutes: labor.reduce((a, l) => a + l.minutes, 0),
    /** Paid crew time on this job not allocated to any task. */
    unallocatedLaborMinutes: labor.filter((l) => l.unallocated).reduce((a, l) => a + l.minutes, 0),
    invoicedCents,
    receivedCents,
    /** Cash position on this job: money in minus cost incurred. */
    cashPositionCents: receivedCents - summary.totalActualCents,
    ...summary,
  };
}

/**
 * "What works" insights across all projects: estimate accuracy by cost code (completed tasks),
 * and projected margin by project type.
 */
export async function portfolioInsights(tx: Tx, orgId: string) {
  const projects = await tx.project.findMany({ where: { orgId, status: { not: "CANCELLED" } }, select: { id: true } });
  const jobCosts = [];
  for (const p of projects) jobCosts.push(await projectJobCost(tx, orgId, p.id));

  const { actuals: labor, overhead } = await laborActuals(tx, orgId, {});
  const doneTasks = await tx.task.findMany({
    where: { project: { orgId }, status: { in: ["DONE", "VERIFIED"] }, estimatedMinutes: { gt: 0 } },
    include: { costCode: true },
  });
  const minutesByTask = new Map<string, number>();
  for (const l of labor) if (l.taskId) minutesByTask.set(l.taskId, (minutesByTask.get(l.taskId) ?? 0) + l.minutes);

  const byCode = new Map<string, { label: string; estimatedMinutes: number; actualMinutes: number; tasks: number }>();
  for (const t of doneTasks) {
    const actual = minutesByTask.get(t.id);
    if (!actual) continue;
    const key = t.costCodeId ?? "_";
    const row = byCode.get(key) ?? { label: t.costCode ? `${t.costCode.code} ${t.costCode.name}` : "Uncoded", estimatedMinutes: 0, actualMinutes: 0, tasks: 0 };
    row.estimatedMinutes += t.estimatedMinutes ?? 0;
    row.actualMinutes += actual;
    row.tasks += 1;
    byCode.set(key, row);
  }
  const estimateAccuracy = [...byCode.values()]
    .map((r) => ({ ...r, overrunPct: r.estimatedMinutes ? (r.actualMinutes - r.estimatedMinutes) / r.estimatedMinutes : null }))
    .sort((a, b) => (b.overrunPct ?? 0) - (a.overrunPct ?? 0));

  const byType = new Map<string, { projectType: string; projects: number; revenueCents: number; projectedProfitCents: number }>();
  for (const jc of jobCosts) {
    const type = jc.project.projectType ?? "Unspecified";
    const row = byType.get(type) ?? { projectType: type, projects: 0, revenueCents: 0, projectedProfitCents: 0 };
    row.projects += 1;
    row.revenueCents += jc.revenueCents;
    row.projectedProfitCents += jc.projectedProfitCents;
    byType.set(type, row);
  }

  // Time tasks spent waiting on materials (status history).
  const events = await tx.taskStatusEvent.findMany({ where: { task: { project: { orgId } } }, orderBy: { at: "asc" } });
  let waitingMinutes = 0;
  const openWait = new Map<string, Date>();
  for (const e of events) {
    if (e.to === "NEEDS_MATERIALS") openWait.set(e.taskId, e.at);
    else if (e.from === "NEEDS_MATERIALS" && openWait.has(e.taskId)) {
      waitingMinutes += minutesBetween(openWait.get(e.taskId)!, e.at);
      openWait.delete(e.taskId);
    }
  }
  const now = new Date();
  for (const at of openWait.values()) waitingMinutes += minutesBetween(at, now);

  return {
    projects: jobCosts.map((j) => ({
      ...j.project,
      revenueCents: j.revenueCents,
      totalActualCents: j.totalActualCents,
      totalBudgetCents: j.totalBudgetCents,
      estimateAtCompletionCents: j.estimateAtCompletionCents,
      projectedProfitCents: j.projectedProfitCents,
      projectedMarginBps: j.projectedMarginBps,
      percentComplete: j.percentComplete,
      alerts: j.lines.filter((l) => l.alert !== "OK").length,
    })),
    estimateAccuracy,
    marginByProjectType: [...byType.values()].map((r) => ({
      ...r,
      marginBps: r.revenueCents ? Math.round((r.projectedProfitCents / r.revenueCents) * 10_000) : null,
    })),
    materialWaitHours: Math.round(waitingMinutes / 6) / 10,
    /** Paid time not allocated to any task, across all jobs + shifts with no job. A coverage signal, never deducted from pay. */
    unallocatedPaidHours: Math.round((labor.filter((l) => l.unallocated).reduce((a, l) => a + l.minutes, 0) + overhead.minutes) / 6) / 10,
    overheadLaborCents: overhead.cents,
    asOf: fromDbDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))),
  };
}
