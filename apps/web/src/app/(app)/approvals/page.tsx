"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage, useTRPC, type RouterOutputs } from "@timepeace/api-client";
import { formatMinutes } from "@timepeace/shared";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button, Card, Empty, ErrorText, Hours, Loading, Money, PageHeader, StatusBadge, cx } from "@/components/ui";

type Tab = "timesheets" | "expenses" | "materials";

export default function ApprovalsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Approvals />
    </Suspense>
  );
}

function Approvals() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = (params.get("tab") as Tab) ?? "timesheets";
  const trpc = useTRPC();
  const summary = useQuery(trpc.approvals.summary.queryOptions());
  const counts = { timesheets: summary.data?.timesheets, expenses: summary.data?.expenses, materials: summary.data?.materials };
  return (
    <>
      <PageHeader title="Approvals" subtitle="Review hours and expenses before they go to payroll" />
      <div className="mb-4 flex gap-1 border-b border-stone-200">
        {(["timesheets", "expenses", "materials"] as Tab[]).map((t) => (
          <button key={t} onClick={() => router.replace(`/approvals?tab=${t}`)} className={cx("-mb-px border-b-2 px-4 py-2 text-sm capitalize", tab === t ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-stone-500")}>
            {t === "materials" ? "Material requests" : t} {counts[t] ? <span className="ml-1 rounded-full bg-brand-50 px-1.5 text-xs text-brand-700">{counts[t]}</span> : null}
          </button>
        ))}
      </div>
      {tab === "timesheets" && <Timesheets />}
      {tab === "expenses" && <Expenses />}
      {tab === "materials" && <Materials />}
    </>
  );
}

type Sheet = RouterOutputs["approvals"]["timesheets"][number];

function Timesheets() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery(trpc.approvals.timesheets.queryOptions());
  const review = useMutation(
    trpc.approvals.reviewTimesheet.mutationOptions({
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: trpc.approvals.pathKey() });
      },
    }),
  );
  if (isLoading) return <Loading />;
  if (!data?.length) return <Empty>No timesheets waiting for approval. 🎉</Empty>;
  return (
    <div className="space-y-3">
      <ErrorText error={review.error ? errorMessage(review.error) : null} />
      {data.length > 1 && (
        <div className="flex justify-end">
          <Button
            variant="secondary"
            disabled={review.isPending}
            onClick={async () => {
              for (const t of data) await review.mutateAsync({ timesheetId: t.id, decision: "APPROVE" }).catch(() => {});
            }}
          >
            Approve all {data.length}
          </Button>
        </div>
      )}
      {data.map((t) => (
        <SheetCard key={t.id} sheet={t} onReview={(decision, note) => review.mutate({ timesheetId: t.id, decision, note })} busy={review.isPending} />
      ))}
    </div>
  );
}

function SheetCard({ sheet, onReview, busy }: { sheet: Sheet; onReview: (d: "APPROVE" | "REJECT", note?: string) => void; busy: boolean }) {
  const [open, setOpen] = useState(sheet.needsReview);
  const byDay = sheet.totals.days;
  const unallocated = Math.max(0, sheet.totals.totalMinutes - sheet.allocatedMinutes);
  return (
    <Card
      title={
        <span>
          {sheet.user.name} <span className="font-normal text-stone-500">· {sheet.period.start} – {sheet.period.end}</span>
          {sheet.isContractor && <span className="ml-2 rounded bg-violet-50 px-1.5 text-xs text-violet-800">1099</span>}
          {sheet.needsReview && <span className="ml-2 rounded bg-red-50 px-1.5 text-xs text-red-700">⚠ shift needs review</span>}
        </span>
      }
      actions={
        <>
          <Button variant="ghost" onClick={() => setOpen(!open)}>
            {open ? "Hide shifts" : `${sheet.shifts.length} shifts`}
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              const note = prompt("Reason for sending back to the worker:");
              if (note) onReview("REJECT", note);
            }}
          >
            Send back
          </Button>
          <Button disabled={busy || sheet.needsReview} title={sheet.needsReview ? "Confirm or correct the flagged shift first" : undefined} onClick={() => onReview("APPROVE")}>
            Approve
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap gap-6 text-sm">
        <div>
          Paid (clock in/out) <strong><Hours minutes={sheet.totals.totalMinutes} /></strong>
        </div>
        <div>
          Regular <Hours minutes={sheet.totals.regularMinutes} />
        </div>
        <div className={cx(sheet.totals.overtimeMinutes > 0 && "font-semibold text-amber-800")}>
          Overtime <Hours minutes={sheet.totals.overtimeMinutes} />
        </div>
        {sheet.totals.doubleTimeMinutes > 0 && (
          <div className="font-semibold text-red-700">
            Double time <Hours minutes={sheet.totals.doubleTimeMinutes} />
          </div>
        )}
        <div className="text-stone-500">
          On tasks <Hours minutes={sheet.allocatedMinutes} /> · not on a task <Hours minutes={unallocated} /> (paid; setup, travel, cleanup)
        </div>
      </div>
      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs">
        {byDay.map((d) => (
          <div key={d.date} className="rounded bg-stone-50 p-1.5">
            <div className="text-stone-500">{new Date(`${d.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" })}</div>
            <div className="font-medium tabular">{formatMinutes(d.workedMinutes)}</div>
          </div>
        ))}
      </div>
      {open && (
        <div className="mt-3 space-y-2">
          {sheet.shifts.map((sh) => (
            <ShiftRow key={sh.id} shift={sh} />
          ))}
        </div>
      )}
    </Card>
  );
}

const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const fmtTime = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function ShiftRow({ shift }: { shift: Sheet["shifts"][number] }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [inAt, setInAt] = useState(toLocalInput(shift.clockInAt));
  const [outAt, setOutAt] = useState(shift.clockOutAt ? toLocalInput(shift.clockOutAt) : "");
  const [reason, setReason] = useState("");
  const edit = useMutation(trpc.approvals.editShift.mutationOptions({ onSuccess: () => { setEditing(false); qc.invalidateQueries({ queryKey: trpc.approvals.pathKey() }); } }));
  return (
    <div className={cx("rounded-md border p-3 text-xs", shift.flag === "AUTO_CLOSED" ? "border-red-200 bg-red-50/40" : "border-stone-100")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <span className="font-medium tabular">
            {shift.clockInAt.toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" })} · {fmtTime(shift.clockInAt)} – {shift.clockOutAt ? fmtTime(shift.clockOutAt) : "still clocked in"}
          </span>
          <span className="ml-2 text-stone-500">
            paid {formatMinutes(shift.paidMinutes)} · on tasks {formatMinutes(shift.allocatedMinutes)}
            {shift.projectName && ` · clocked in at ${shift.projectName}`}
            {shift.hasGeo && " · 📍"}
          </span>
          {shift.flag === "AUTO_CLOSED" && <div className="mt-1 text-red-700">⚠ No clock-out recorded; closed at the last activity. Confirm the real end time with the worker.</div>}
          {shift.flag === "EDITED" && <span className="ml-2 text-stone-400">(edited)</span>}
        </div>
        <Button variant="ghost" onClick={() => setEditing(!editing)}>
          {editing ? "Cancel" : shift.flag === "AUTO_CLOSED" ? "Confirm / fix times" : "Edit"}
        </Button>
      </div>
      {editing && (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            edit.mutate({ id: shift.id, clockInAt: new Date(inAt).toISOString(), clockOutAt: new Date(outAt).toISOString(), reason });
          }}
        >
          <label className="flex flex-col gap-1">Clock in<input type="datetime-local" className="rounded border border-stone-300 px-1.5 py-1" value={inAt} onChange={(e) => setInAt(e.target.value)} /></label>
          <label className="flex flex-col gap-1">Clock out<input type="datetime-local" className="rounded border border-stone-300 px-1.5 py-1" value={outAt} onChange={(e) => setOutAt(e.target.value)} required /></label>
          <label className="flex flex-1 flex-col gap-1">Reason (saved to audit log)<input className="rounded border border-stone-300 px-1.5 py-1" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} placeholder="e.g. Confirmed with worker: left at 4:15" /></label>
          <Button type="submit" disabled={edit.isPending}>Save</Button>
          {edit.error && <span className="text-red-700">{errorMessage(edit.error)}</span>}
        </form>
      )}
      <ul className="mt-2 space-y-0.5 text-stone-600">
        {shift.breaks.map((b) => (
          <li key={b.id}>
            Break {fmtTime(b.startedAt)} – {b.endedAt ? fmtTime(b.endedAt) : "open"}
          </li>
        ))}
        {shift.entries.map((e) => (
          <li key={e.id}>
            • {e.projectName} · {e.taskTitle ?? "—"} · {fmtTime(e.startedAt)}–{e.endedAt ? fmtTime(e.endedAt) : "running"} · <span className="tabular">{formatMinutes(e.minutes)}</span>
          </li>
        ))}
        {shift.unallocatedMinutes > 0 && <li className="text-stone-400">• Not on a task: {formatMinutes(shift.unallocatedMinutes)} (paid)</li>}
      </ul>
    </div>
  );
}

function Expenses() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery(trpc.approvals.expenses.queryOptions());
  const review = useMutation(trpc.approvals.reviewExpense.mutationOptions({ onSuccess: () => qc.invalidateQueries({ queryKey: trpc.approvals.pathKey() }) }));
  if (isLoading) return <Loading />;
  if (!data?.length) return <Empty>No expenses waiting for review.</Empty>;
  return (
    <Card>
      <ErrorText error={review.error ? errorMessage(review.error) : null} />
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-stone-500">
          <tr>
            <th className="py-1.5">Date</th>
            <th>Submitted by</th>
            <th>Vendor</th>
            <th>Project / task</th>
            <th className="text-right">Amount</th>
            <th>Paid with</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.map((e) => (
            <tr key={e.id} className="border-t border-stone-100">
              <td className="py-2 tabular">{e.spentOn.toISOString().slice(0, 10)}</td>
              <td>{e.user.name}</td>
              <td>
                {e.vendorName}
                {e.note && <div className="text-xs text-stone-500">{e.note}</div>}
              </td>
              <td className="text-xs">
                {e.project.name}
                {e.task && <div className="text-stone-500">{e.task.title}</div>}
              </td>
              <td className="text-right">
                <Money cents={e.amountCents} showCents />
              </td>
              <td className="text-xs">{e.paidBy === "PERSONAL" ? <span className="text-amber-800">personal: reimburse</span> : "company"}</td>
              <td className="text-right whitespace-nowrap">
                <Button
                  variant="ghost"
                  onClick={() => {
                    const note = prompt("Reason for rejecting:");
                    if (note) review.mutate({ expenseId: e.id, decision: "REJECT", note });
                  }}
                >
                  Reject
                </Button>
                <Button onClick={() => review.mutate({ expenseId: e.id, decision: "APPROVE" })}>Approve</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Materials() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery(trpc.approvals.materialRequests.queryOptions());
  const update = useMutation(trpc.approvals.updateMaterialRequest.mutationOptions({ onSuccess: () => qc.invalidateQueries({ queryKey: trpc.approvals.pathKey() }) }));
  if (isLoading) return <Loading />;
  if (!data?.length) return <Empty>No open material requests.</Empty>;
  return (
    <Card>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-stone-500">
          <tr>
            <th className="py-1.5">Requested</th>
            <th>Item</th>
            <th>Project / task</th>
            <th>By</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.map((m) => (
            <tr key={m.id} className="border-t border-stone-100">
              <td className="py-2 text-xs tabular">{m.createdAt.toLocaleDateString()}</td>
              <td>
                {m.quantity && <strong>{m.quantity} × </strong>}
                {m.description}
                {m.neededBy && <div className="text-xs text-stone-500">needed by {m.neededBy.toISOString().slice(0, 10)}</div>}
              </td>
              <td className="text-xs">
                {m.task.project.name}
                <div className="text-stone-500">{m.task.title}</div>
              </td>
              <td>{m.requestedBy.name}</td>
              <td>
                <StatusBadge status={m.status} />
              </td>
              <td className="text-right whitespace-nowrap">
                {m.status === "REQUESTED" && (
                  <Button variant="secondary" onClick={() => update.mutate({ id: m.id, status: "ORDERED" })}>
                    Mark ordered
                  </Button>
                )}
                <Button className="ml-1" onClick={() => update.mutate({ id: m.id, status: "DELIVERED" })}>
                  Delivered
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
