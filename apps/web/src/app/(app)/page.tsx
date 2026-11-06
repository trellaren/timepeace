"use client";

import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@timepeace/api-client";
import Link from "next/link";
import { useSession } from "@/components/AppShell";
import { Card, Hours, Loading, Money, PageHeader, StatusBadge } from "@/components/ui";
import { can } from "@/lib/session";

export default function Dashboard() {
  const session = useSession();
  if (!session) return null;
  const role = session.role;
  return (
    <>
      <PageHeader title={`Good day, ${session.user.name.split(" ")[0]}`} subtitle={session.org.name} />
      <div className="grid gap-6">
        {can.manage(role) && <OpenQuestions />}
        {can.manage(role) && <ManagerQueues />}
        {can.finance(role) && <ProjectHealth />}
        {can.payroll(role) && <PayrollStatus />}
        {role === "WORKER" && <WorkerWeek />}
      </div>
    </>
  );
}

function ManagerQueues() {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.approvals.summary.queryOptions());
  const tiles = [
    { label: "Timesheets to approve", value: data?.timesheets, href: "/approvals?tab=timesheets" },
    { label: "Expenses to review", value: data?.expenses, href: "/approvals?tab=expenses" },
    { label: "Material requests", value: data?.materials, href: "/approvals?tab=materials" },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {tiles.map((t) => (
        <Link key={t.label} href={t.href} className="rounded-lg border border-line bg-surface p-4 hover:border-accent">
          <div className="text-3xl font-semibold tabular text-ink">{t.value ?? "–"}</div>
          <div className="mt-1 text-sm text-muted">{t.label}</div>
        </Link>
      ))}
    </div>
  );
}

/** The crew's unanswered questions, oldest first: the office's queue. */
function OpenQuestions() {
  const trpc = useTRPC();
  const { data, isLoading } = useQuery({ ...trpc.discussion.openQuestions.queryOptions(), refetchInterval: 60_000 });
  return (
    <Card title={`Open questions${data?.length ? ` (${data.length})` : ""}`}>
      {isLoading || !data ? (
        <Loading />
      ) : data.length === 0 ? (
        <p className="text-sm text-muted">No open questions from the crew.</p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {data.map((q) => (
            <li key={q.id}>
              <Link href={`/projects/${q.project.id}?task=${encodeURIComponent(q.task.id)}`} className="flex gap-3 py-2.5 hover:bg-surface-2">
                <span aria-hidden className="mt-0.5 font-bold text-warning-ink">?</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">{q.body || "(photo)"}</span>
                  <span className="block text-xs text-muted">
                    {q.author.name} · {q.task.title} · {q.project.name}
                    {q.photos > 0 && ` · ${q.photos} photo${q.photos === 1 ? "" : "s"}`}
                  </span>
                </span>
                <span className="text-xs whitespace-nowrap text-muted tabular" title={q.at.toLocaleString()}>
                  {waited(q.at)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** How long a question has waited: "12 min", "3 h", "2 d". */
function waited(at: Date) {
  const min = Math.max(0, Math.round((Date.now() - at.getTime()) / 60_000));
  if (min < 60) return `${min} min`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h`;
  return `${Math.round(min / 1440)} d`;
}

function ProjectHealth() {
  const trpc = useTRPC();
  const { data, isLoading } = useQuery(trpc.finance.portfolio.queryOptions());
  return (
    <Card title="Project health" actions={<Link href="/finance" className="text-sm text-accent-ink">Finance details →</Link>}>
      {isLoading || !data ? (
        <Loading />
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="py-2">Project</th>
              <th>Status</th>
              <th className="text-right">Complete</th>
              <th className="text-right">Cost to date</th>
              <th className="text-right">Projected margin</th>
              <th className="text-right">Budget alerts</th>
            </tr>
          </thead>
          <tbody>
            {data.projects.map((p) => (
              <tr key={p.id} className="border-t border-line-soft">
                <td className="py-2">
                  <Link href={`/projects/${p.id}`} className="font-medium text-ink hover:text-accent-ink">
                    {p.name}
                  </Link>
                  <div className="text-xs text-faint">{p.projectType}</div>
                </td>
                <td>
                  <StatusBadge status={p.status} />
                </td>
                <td className="text-right tabular">{Math.round(p.percentComplete * 100)}%</td>
                <td className="text-right">
                  <Money cents={p.totalActualCents} />
                </td>
                <td className="text-right tabular">{p.projectedMarginBps == null ? "–" : `${(p.projectedMarginBps / 100).toFixed(1)}%`}</td>
                <td className="text-right tabular">{p.alerts || "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function PayrollStatus() {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.payroll.periods.queryOptions());
  const ready = data?.filter((p) => p.counts.APPROVED) ?? [];
  return (
    <Card title="Payroll" actions={<Link href="/payroll" className="text-sm text-accent-ink">Open payroll →</Link>}>
      {ready.length === 0 ? (
        <p className="text-sm text-muted">No approved timesheets waiting for export.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {ready.map((p) => (
            <li key={p.id}>
              {p.start} – {p.end}: <strong>{p.counts.APPROVED}</strong> approved timesheet(s) ready to export
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function WorkerWeek() {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.field.myPeriod.queryOptions());
  return (
    <Card title="This pay period">
      <p className="mb-2 text-sm text-muted">Use the Timepeace mobile app to start and stop tasks, log expenses and submit your hours.</p>
      {data && (
        <p className="text-sm">
          {data.period.start} – {data.period.end}: <Hours minutes={data.totals.totalMinutes} /> recorded
          {data.timesheet && (
            <>
              {" "}
              · <StatusBadge status={data.timesheet.status} />
            </>
          )}
        </p>
      )}
    </Card>
  );
}
