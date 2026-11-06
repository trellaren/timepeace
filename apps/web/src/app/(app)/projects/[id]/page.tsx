"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage, useTRPC, type RouterOutputs } from "@timepeace/api-client";
import { COST_CATEGORIES, TASK_STATUSES, dollarsToCents, formatCents, toLocalDate, type CostCategory, type TaskStatus } from "@timepeace/shared";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useState } from "react";
import { useSession } from "@/components/AppShell";
import { TaskPanel } from "@/components/TaskPanel";
import { AlertBadge, BudgetBar, Button, Card, ErrorText, Input, Loading, Money, PageHeader, Select, StatusBadge, cx } from "@/components/ui";
import { can } from "@/lib/session";

type Project = RouterOutputs["projects"]["get"];

export default function ProjectPageRoute() {
  // useSearchParams (the open task) needs a Suspense boundary.
  return (
    <Suspense fallback={<Loading />}>
      <ProjectPage />
    </Suspense>
  );
}

function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const trpc = useTRPC();
  const session = useSession();
  const router = useRouter();
  const openTaskId = useSearchParams().get("task");
  const { data: project, isLoading } = useQuery(trpc.projects.get.queryOptions({ id }));
  const [tab, setTab] = useState<"tasks" | "budget">("tasks");
  const openTask = useCallback((taskId: string | null) => router.replace(taskId ? `/projects/${id}?task=${encodeURIComponent(taskId)}` : `/projects/${id}`, { scroll: false }), [router, id]);
  const closeTask = useCallback(() => openTask(null), [openTask]);
  if (isLoading || !project) return <Loading />;
  const showFinance = can.finance(session?.role);
  const openTaskRow = openTaskId ? project.tasks.find((t) => t.id === openTaskId) : undefined;

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
      <div className="mb-4 flex gap-1 border-b border-line">
        {(["tasks", ...(showFinance ? ["budget"] : [])] as const).map((t) => (
          <button key={t} onClick={() => setTab(t as "tasks" | "budget")} className={cx("-mb-px border-b-2 px-4 py-2 text-sm", tab === t ? "border-accent font-medium text-accent-ink" : "border-transparent text-muted hover:text-ink")}>
            {t === "tasks" ? "Tasks & assignments" : "Budget & job cost"}
          </button>
        ))}
      </div>
      {tab === "tasks" ? (
        <TasksTab project={project} canEdit={can.manage(session?.role)} canDiscuss={can.discuss(session?.role)} onOpenTask={openTask} />
      ) : (
        <BudgetTab project={project} canEdit={can.manage(session?.role)} />
      )}
      {openTaskRow && (
        <TaskPanel task={openTaskRow} phaseName={project.phases.find((p) => p.id === openTaskRow.phaseId)?.name ?? null} showDiscussion={can.discuss(session?.role)} onClose={closeTask} />
      )}
    </>
  );
}

function TasksTab({ project, canEdit, canDiscuss, onOpenTask }: { project: Project; canEdit: boolean; canDiscuss: boolean; onOpenTask: (taskId: string) => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const discussion = useQuery({ ...trpc.discussion.unread.queryOptions(), enabled: canDiscuss, refetchInterval: 60_000 });
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
            <thead className="text-left text-xs text-muted">
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
                <tr key={t.id} className="border-t border-line-soft align-top">
                  <td className="py-2 pr-2">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <button className="text-left font-medium text-ink hover:text-accent-ink hover:underline" onClick={() => onOpenTask(t.id)}>
                        {t.title}
                      </button>
                      <DiscussionBadges counts={discussion.data?.[t.id]} onOpen={() => onOpenTask(t.id)} />
                    </div>
                    {t.statusNote && <div className="text-xs text-warning-ink">{t.statusNote}</div>}
                    {t.materialRequests.map((m) => (
                      <div key={m.id} className="text-xs text-muted">
                        Needs: {m.quantity ? `${m.quantity} × ` : ""}
                        {m.description} <StatusBadge status={m.status} />
                      </div>
                    ))}
                  </td>
                  <td className="text-xs text-muted">{t.costCode ? `${t.costCode.code} ${t.costCode.name}` : "—"}</td>
                  <td className="text-right tabular">{t.estimatedMinutes ? (t.estimatedMinutes / 60).toFixed(0) : "—"}</td>
                  <td className="pl-4">
                    {canEdit ? (
                      <select className="rounded border border-line bg-surface px-1 py-0.5 text-xs" value={t.status} onChange={(e) => update.mutate({ id: t.id, status: e.target.value as TaskStatus })}>
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
                        <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 text-xs">
                          {a.user.name.split(" ")[0]}
                          {canEdit && (
                            <button aria-label={`Unassign ${a.user.name}`} className="text-faint hover:text-critical-ink" onClick={() => unassign.mutate({ taskId: t.id, userId: a.user.id })}>
                              ×
                            </button>
                          )}
                        </span>
                      ))}
                      {canEdit && (
                        <select
                          className="w-24 rounded border border-dashed border-line-strong bg-surface px-1 py-0.5 text-xs text-muted"
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

/** Unread messages and open questions on a task. Text, not color alone. */
function DiscussionBadges({ counts, onOpen }: { counts?: { unread: number; openQuestions: number }; onOpen: () => void }) {
  if (!counts || (!counts.unread && !counts.openQuestions)) return null;
  const label = [counts.openQuestions && `${counts.openQuestions} open question${counts.openQuestions === 1 ? "" : "s"}`, counts.unread && `${counts.unread} unread`].filter(Boolean).join(", ");
  return (
    <button onClick={onOpen} aria-label={label} title={label} className="inline-flex gap-1 text-xs">
      {counts.openQuestions > 0 && <span className="rounded bg-warning-soft px-1.5 font-medium text-warning-ink">? {counts.openQuestions}</span>}
      {counts.unread > 0 && <span className="rounded bg-accent-soft px-1.5 font-medium text-accent-ink">💬 {counts.unread}</span>}
    </button>
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
      className="mt-3 flex flex-wrap items-end gap-2 border-t border-line-soft pt-3"
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
          <div key={t.label} className="rounded-lg border border-line bg-surface p-3">
            <div className="text-xs text-muted">{t.label}</div>
            <div className="mt-1 text-lg font-semibold tabular text-ink">{t.value}</div>
            {t.sub && <div className="text-xs text-faint">{t.sub}</div>}
          </div>
        ))}
      </div>
      <Card title="Budget vs actual by cost code">
        <p className="mb-3 text-xs text-muted">
          <span className="mr-1 inline-block h-2 w-4 rounded-sm align-middle" style={{ background: "var(--color-series-1)" }} />
          actual cost ·
          <span className="mx-1 inline-block h-3 w-0.5 bg-ink-2 align-middle" />
          budget. Labor is burdened at each worker&apos;s rate; 1099 hours count as subcontract.
        </p>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
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
              <tr key={l.key} className="border-t border-line-soft">
                <td className="py-1.5">{l.costCodeLabel}</td>
                <td className="text-xs text-muted">{l.category.toLowerCase()}</td>
                <td className="text-right">
                  <Money cents={l.budgetCents} />
                </td>
                <td className="text-right">
                  <Money cents={l.actualCents} />
                </td>
                <td className={cx("text-right", l.varianceCents < 0 && "text-critical-ink")}>
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
            <tr className="border-t-2 border-line font-semibold">
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
            className="mt-4 flex flex-wrap items-end gap-2 border-t border-line-soft pt-4"
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
