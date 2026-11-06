"use client";

import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@timepeace/api-client";
import Link from "next/link";
import { Card, Loading, Money, PageHeader, StatusBadge } from "@/components/ui";

const pct = (bps: number | null) => (bps == null ? "–" : `${(bps / 100).toFixed(1)}%`);

export default function FinancePage() {
  const trpc = useTRPC();
  const { data, isLoading } = useQuery(trpc.finance.portfolio.queryOptions());
  if (isLoading || !data) return <Loading />;
  const maxOverrun = Math.max(0.01, ...data.estimateAccuracy.map((e) => Math.abs(e.overrunPct ?? 0)));
  const totals = data.projects.reduce(
    (a, p) => ({ revenue: a.revenue + p.revenueCents, cost: a.cost + p.totalActualCents, profit: a.profit + p.projectedProfitCents }),
    { revenue: 0, cost: 0, profit: 0 },
  );

  return (
    <>
      <PageHeader title="Finance" subtitle="Where you make money and where you lose it" />
      <div className="mb-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[
          { label: "Contracted & projected revenue", v: <Money cents={totals.revenue} /> },
          { label: "Cost to date (all jobs)", v: <Money cents={totals.cost} /> },
          { label: "Projected gross profit", v: <Money cents={totals.profit} /> },
          { label: "Paid crew time not on a task", v: <span className="tabular">{data.unallocatedPaidHours} hrs</span> },
          { label: "Tasks waiting on materials", v: <span className="tabular">{data.materialWaitHours} task-hrs</span> },
        ].map((t) => (
          <div key={t.label} className="rounded-lg border border-stone-200 bg-white p-4">
            <div className="text-xs text-stone-500">{t.label}</div>
            <div className="mt-1 text-xl font-semibold text-stone-900">{t.v}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Projects" className="lg:col-span-2">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-stone-500">
              <tr>
                <th className="py-1.5">Project</th>
                <th>Status</th>
                <th className="text-right">Revenue</th>
                <th className="text-right">Budget</th>
                <th className="text-right">Cost to date</th>
                <th className="text-right">Est. at completion</th>
                <th className="text-right">Projected profit</th>
                <th className="text-right">Margin</th>
              </tr>
            </thead>
            <tbody>
              {data.projects.map((p) => (
                <tr key={p.id} className="border-t border-stone-100">
                  <td className="py-2">
                    <Link className="font-medium hover:text-brand-600" href={`/projects/${p.id}`}>
                      {p.name}
                    </Link>
                    <div className="text-xs text-stone-400">
                      {p.projectType} · {p.contractType.replace(/_/g, " ").toLowerCase()} · {Math.round(p.percentComplete * 100)}% complete
                    </div>
                  </td>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="text-right"><Money cents={p.revenueCents} /></td>
                  <td className="text-right"><Money cents={p.totalBudgetCents} /></td>
                  <td className="text-right"><Money cents={p.totalActualCents} /></td>
                  <td className="text-right"><Money cents={p.estimateAtCompletionCents} /></td>
                  <td className={p.projectedProfitCents < 0 ? "text-right text-red-700" : "text-right"}><Money cents={p.projectedProfitCents} /></td>
                  <td className="text-right tabular">{pct(p.projectedMarginBps)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-stone-400">
            Estimate at completion extrapolates cost to date by percent complete (hours-weighted). Below 5% complete the budget is used instead. Labor includes all paid
            shift time: time not on a task is charged to the job the crew clocked into.
          </p>
        </Card>

        <Card title="Estimate accuracy by trade (completed tasks)">
          {data.estimateAccuracy.length === 0 ? (
            <p className="text-sm text-stone-500">Complete some tasks with time logged to see how your estimates hold up.</p>
          ) : (
            <>
              <p className="mb-3 text-xs text-stone-500">Actual labor hours vs estimate. Bars right of center ran over; left ran under.</p>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-stone-500">
                  <tr>
                    <th className="py-1">Cost code</th>
                    <th className="text-right">Est. hrs</th>
                    <th className="text-right">Actual</th>
                    <th className="w-2/5 pl-3 text-center">Under ← → Over</th>
                    <th className="text-right">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {data.estimateAccuracy.map((e) => {
                    const o = e.overrunPct ?? 0;
                    const w = `${(Math.abs(o) / maxOverrun) * 50}%`;
                    return (
                      <tr key={e.label} className="border-t border-stone-100" title={`${e.tasks} task(s)`}>
                        <td className="py-1.5">{e.label}</td>
                        <td className="text-right tabular">{Math.round(e.estimatedMinutes / 60)}</td>
                        <td className="text-right tabular">{Math.round(e.actualMinutes / 60)}</td>
                        <td className="pl-3">
                          <div className="relative h-3">
                            <div className="absolute inset-y-0 left-1/2 w-px bg-stone-400" />
                            <div
                              className={o >= 0 ? "absolute inset-y-0.5 left-1/2 rounded-r" : "absolute inset-y-0.5 right-1/2 rounded-l"}
                              style={{ width: w, background: o >= 0 ? "#e34948" : "#2a78d6" }}
                            />
                          </div>
                        </td>
                        <td className="text-right tabular">{o >= 0 ? "+" : ""}{Math.round(o * 100)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </Card>

        <Card title="Margin by project type">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-stone-500">
              <tr>
                <th className="py-1">Type</th>
                <th className="text-right">Jobs</th>
                <th className="text-right">Revenue</th>
                <th className="text-right">Projected profit</th>
                <th className="text-right">Margin</th>
              </tr>
            </thead>
            <tbody>
              {data.marginByProjectType
                .sort((a, b) => (b.marginBps ?? 0) - (a.marginBps ?? 0))
                .map((r) => (
                  <tr key={r.projectType} className="border-t border-stone-100">
                    <td className="py-1.5">{r.projectType}</td>
                    <td className="text-right tabular">{r.projects}</td>
                    <td className="text-right"><Money cents={r.revenueCents} /></td>
                    <td className="text-right"><Money cents={r.projectedProfitCents} /></td>
                    <td className="text-right tabular">{pct(r.marginBps)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-stone-400">Projected margins include jobs still in progress; compare completed jobs as history builds up.</p>
        </Card>
      </div>
    </>
  );
}
