"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage, useTRPC, type RouterOutputs } from "@timepeace/api-client";
import { COST_CATEGORIES, TASK_STATUSES, dollarsToCents, formatCents, toLocalDate, type CostCategory, type TaskStatus } from "@timepeace/shared";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useSession } from "@/components/AppShell";
import { AlertBadge, BudgetBar, Button, Card, ErrorText, Input, Loading, Money, PageHeader, Select, StatusBadge, cx } from "@/components/ui";
import { can } from "@/lib/session";

type Project = RouterOutputs["projects"]["get"];

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const trpc = useTRPC();
  const session = useSession();
  const { data: project, isLoading } = useQuery(trpc.projects.get.queryOptions({ id }));
  const [tab, setTab] = useState<"tasks" | "budget">("tasks");
  if (isLoading || !project) return <Loading />;
  const showFinance = can.finance(session?.role);

  return (
    <>
      <PageHeader
        title={project.name}
        subtitle={
          <>
            {project.client?.name} · {project.address} · <StatusBadge status={project.status} />
          </>
        }
      />
      <div className="mb-4 flex gap-1 border-b border-stone-200">
        {(["tasks", ...(showFinance ? ["budget"] : [])] as const).map((t) => (
          <button key={t} onClick={() => setTab(t as "tasks" | "budget")} className={cx("-mb-px border-b-2 px-4 py-2 text-sm", tab === t ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-stone-500 hover:text-stone-800")}>
            {t === "tasks" ? "Tasks & assignments" : "Budget & job cost"}
          </button>
        ))}
      </div>
      {tab === "tasks" ? <TasksTab project={project} canEdit={can.manage(session?.role)} /> : <BudgetTab project={project} canEdit={can.manage(session?.role)} />}
    </>
  );
}

function TasksTab({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const workers = useQuery({ ...trpc.org.workers.queryOptions(), enabled: canEdit });
  const costCodes = useQuery(trpc.org.costCodes.queryOptions());
  const refresh = () => qc.invalidateQueries({ queryKey: trpc.projects.get.queryKey({ id: project.id }) });
  const update = useMutation(trpc.tasks.update.mutationOptions({ onSuccess: refresh }));
  const assign = useMutation(trpc.tasks.assign.mutationOptions({ onSuccess: refresh }));
  const unassign = useMutation(trpc.tasks.unassign.mutationOptions({ onSuccess: refresh }));
  const addPhase = useMutation(trpc.projects.addPhase.mutationOptions({ onSuccess: refresh }));
  const [phaseName, setPhaseName] = useState("");
  const today = toLocalDate(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone);
  const err = update.error ?? assign.error ?? unassign.error;

  const groups = [...project.phases.map((p) => ({ id: p.id as string | null, name: p.name })), { id: null, name: "Unphased" }]
    .map((g) => ({ ...g, tasks: project.tasks.filter((t) => t.phaseId === g.id) }))
    .filter((g) => g.id !== null || g.tasks.length > 0);

  return (
    <div className="space-y-4">
      <ErrorText error={err ? errorMessage(err) : null} />
      {groups.map((g) => (
        <Card key={g.id ?? "none"} title={g.name}>
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-[34%]" />
              <col className="w-[18%]" />
              <col className="w-[8%]" />
              <col className="w-[14%]" />
              <col />
            </colgroup>
            <thead className="text-left text-xs text-stone-500">
              <tr>
                <th className="py-1.5">Task</th>
                <th>Cost code</th>
                <th className="text-right">Est. hrs</th>
                <th className="pl-4">Status</th>
                <th>Assigned</th>
              </tr>
            </thead>
            <tbody>
              {g.tasks.map((t) => (
                <tr key={t.id} className="border-t border-stone-100 align-top">
                  <td className="py-2 pr-2">
                    <div className="font-medium text-stone-800">{t.title}</div>
                    {t.statusNote && <div className="text-xs text-amber-700">{t.statusNote}</div>}
                    {t.materialRequests.map((m) => (
                      <div key={m.id} className="text-xs text-stone-500">
                        Needs: {m.quantity ? `${m.quantity} × ` : ""}
                        {m.description} <StatusBadge status={m.status} />
                      </div>
                    ))}
                  </td>
                  <td className="text-xs text-stone-500">{t.costCode ? `${t.costCode.code} ${t.costCode.name}` : "—"}</td>
                  <td className="text-right tabular">{t.estimatedMinutes ? (t.estimatedMinutes / 60).toFixed(0) : "—"}</td>
                  <td className="pl-4">
                    {canEdit ? (
                      <select className="rounded border border-stone-200 bg-white px-1 py-0.5 text-xs" value={t.status} onChange={(e) => update.mutate({ id: t.id, status: e.target.value as TaskStatus })}>
                        {TASK_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s.replace(/_/g, " ").toLowerCase()}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <StatusBadge status={t.status} />
                    )}
                  </td>
                  <td>
                    <div className="flex flex-wrap items-center gap-1">
                      {t.assignments.map((a) => (
                        <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-xs">
                          {a.user.name.split(" ")[0]}
                          {canEdit && (
                            <button aria-label={`Unassign ${a.user.name}`} className="text-stone-400 hover:text-red-600" onClick={() => unassign.mutate({ taskId: t.id, userId: a.user.id })}>
                              ×
                            </button>
                          )}
                        </span>
                      ))}
                      {canEdit && (
                        <select
                          className="w-24 rounded border border-dashed border-stone-300 bg-white px-1 py-0.5 text-xs text-stone-500"
                          value=""
                          onChange={(e) => e.target.value && assign.mutate({ taskId: t.id, userId: e.target.value, scheduledDate: today })}
                        >
                          <option value="">+ assign</option>
                          {workers.data
                            ?.filter((w) => !t.assignments.some((a) => a.user.id === w.id))
                            .map((w) => (
                              <option key={w.id} value={w.id}>
                                {w.name}
                              </option>
                            ))}
                        </select>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {canEdit && <AddTask projectId={project.id} phaseId={g.id} costCodes={costCodes.data ?? []} onAdded={refresh} />}
        </Card>
      ))}
      {canEdit && (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (phaseName) addPhase.mutate({ projectId: project.id, name: phaseName }, { onSuccess: () => setPhaseName("") });
          }}
        >
          <Input label="New phase" value={phaseName} onChange={(e) => setPhaseName(e.target.value)} placeholder="e.g. Landscaping" />
          <Button variant="secondary" type="submit">
            Add phase
          </Button>
        </form>
      )}
    </div>
  );
}

function AddTask({ projectId, phaseId, costCodes, onAdded }: { projectId: string; phaseId: string | null; costCodes: { id: string; code: string; name: string }[]; onAdded: () => void }) {
  const trpc = useTRPC();
  const create = useMutation(trpc.tasks.create.mutationOptions());
  const [title, setTitle] = useState("");
  const [costCodeId, setCostCodeId] = useState("");
  const [hours, setHours] = useState("");
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2 border-t border-stone-100 pt-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title) return;
        await create.mutateAsync({ projectId, phaseId, title, costCodeId: costCodeId || null, estimatedMinutes: hours ? Math.round(Number(hours) * 60) : null });
        setTitle("");
        setHours("");
        onAdded();
      }}
    >
      <Input className="min-w-64 flex-1" placeholder="Add a task…" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Task title" />
      <Select value={costCodeId} onChange={(e) => setCostCodeId(e.target.value)} aria-label="Cost code">
        <option value="">Cost code</option>
        {costCodes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.code} {c.name}
          </option>
        ))}
      </Select>
      <Input className="w-24" placeholder="Est. hrs" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} aria-label="Estimated hours" />
      <Button type="submit" variant="secondary" disabled={create.isPending}>
        Add
      </Button>
    </form>
  );
}

function BudgetTab({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { data: jc } = useQuery(trpc.projects.jobCost.queryOptions({ id: project.id }));
  const costCodes = useQuery(trpc.org.costCodes.queryOptions());
  const upsert = useMutation(
    trpc.projects.upsertBudgetLine.mutationOptions({
      onSuccess: () => qc.invalidateQueries({ queryKey: trpc.projects.jobCost.queryKey({ id: project.id }) }),
    }),
  );
  const [line, setLine] = useState({ costCodeId: "", category: "MATERIAL", amount: "" });
  if (!jc) return <Loading />;
  const max = Math.max(...jc.lines.map((l) => Math.max(l.budgetCents, l.actualCents)));
  const pct = (bps: number | null) => (bps == null ? "–" : `${(bps / 100).toFixed(1)}%`);
  const tiles = [
    { label: jc.project.contractType === "FIXED" ? "Contract + change orders" : "Projected billings", value: formatCents(jc.revenueCents, { showCents: false }) },
    { label: "Cost to date", value: formatCents(jc.totalActualCents, { showCents: false }) },
    { label: "Est. cost at completion", value: formatCents(jc.estimateAtCompletionCents, { showCents: false }), sub: `budget ${formatCents(jc.totalBudgetCents, { showCents: false })}` },
    { label: "Projected profit", value: formatCents(jc.projectedProfitCents, { showCents: false }), sub: `${pct(jc.projectedMarginBps)} margin` },
    { label: "Complete", value: `${Math.round(jc.percentComplete * 100)}%`, sub: `${Math.round(jc.laborMinutes / 60)} labor hrs` },
    { label: "Cash position", value: formatCents(jc.cashPositionCents, { showCents: false }), sub: `received ${formatCents(jc.receivedCents, { showCents: false })}` },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border border-stone-200 bg-white p-3">
            <div className="text-xs text-stone-500">{t.label}</div>
            <div className="mt-1 text-lg font-semibold tabular text-stone-900">{t.value}</div>
            {t.sub && <div className="text-xs text-stone-400">{t.sub}</div>}
          </div>
        ))}
      </div>
      <Card title="Budget vs actual by cost code">
        <p className="mb-3 text-xs text-stone-500">
          <span className="mr-1 inline-block h-2 w-4 rounded-sm align-middle" style={{ background: "var(--series-1)" }} />
          actual cost ·
          <span className="mx-1 inline-block h-3 w-0.5 bg-stone-700 align-middle" />
          budget. Labor is burdened at each worker&apos;s rate; 1099 hours count as subcontract.
        </p>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-stone-500">
            <tr>
              <th className="py-1.5">Cost code</th>
              <th>Category</th>
              <th className="text-right">Budget</th>
              <th className="text-right">Actual</th>
              <th className="text-right">Variance</th>
              <th className="w-1/4 pl-4" />
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {jc.lines.map((l) => (
              <tr key={l.key} className="border-t border-stone-100">
                <td className="py-1.5">{l.costCodeLabel}</td>
                <td className="text-xs text-stone-500">{l.category.toLowerCase()}</td>
                <td className="text-right">
                  <Money cents={l.budgetCents} />
                </td>
                <td className="text-right">
                  <Money cents={l.actualCents} />
                </td>
                <td className={cx("text-right", l.varianceCents < 0 && "text-red-700")}>
                  <Money cents={l.varianceCents} />
                </td>
                <td className="pl-4">
                  <BudgetBar budget={l.budgetCents} actual={l.actualCents} max={max} />
                </td>
                <td className="pl-2">
                  <AlertBadge alert={l.alert} />
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-stone-200 font-semibold">
              <td className="py-2">Total</td>
              <td />
              <td className="text-right">
                <Money cents={jc.totalBudgetCents} />
              </td>
              <td className="text-right">
                <Money cents={jc.totalActualCents} />
              </td>
              <td className="text-right">
                <Money cents={jc.totalBudgetCents - jc.totalActualCents} />
              </td>
              <td colSpan={2} />
            </tr>
          </tbody>
        </table>
        {canEdit && (
          <form
            className="mt-4 flex flex-wrap items-end gap-2 border-t border-stone-100 pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!line.costCodeId || !line.amount) return;
              upsert.mutate(
                { projectId: project.id, costCodeId: line.costCodeId, category: line.category as CostCategory, amountCents: dollarsToCents(line.amount) },
                { onSuccess: () => setLine({ ...line, amount: "" }) },
              );
            }}
          >
            <Select label="Cost code" value={line.costCodeId} onChange={(e) => setLine({ ...line, costCodeId: e.target.value })}>
              <option value="">Select…</option>
              {costCodes.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} {c.name}
                </option>
              ))}
            </Select>
            <Select label="Category" value={line.category} onChange={(e) => setLine({ ...line, category: e.target.value })}>
              {COST_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.toLowerCase()}
                </option>
              ))}
            </Select>
            <Input label="Budget amount ($)" inputMode="decimal" value={line.amount} onChange={(e) => setLine({ ...line, amount: e.target.value })} />
            <Button type="submit" variant="secondary" disabled={upsert.isPending}>
              Set budget line
            </Button>
            <ErrorText error={upsert.error ? errorMessage(upsert.error) : null} />
          </form>
        )}
      </Card>
    </div>
  );
}
