"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage, useTRPC } from "@timepeace/api-client";
import { useEffect, useState } from "react";
import { Button, Card, Empty, ErrorText, Loading, Money, PageHeader, StatusBadge, cx } from "@/components/ui";
import { downloadFile } from "@/lib/trpc";

export default function PayrollPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const periods = useQuery(trpc.payroll.periods.queryOptions());
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (!selected && periods.data?.length) setSelected((periods.data.find((p) => p.counts.APPROVED) ?? periods.data[0])!.id);
  }, [periods.data, selected]);
  const detail = useQuery({ ...trpc.payroll.period.queryOptions({ payPeriodId: selected ?? "" }), enabled: !!selected });
  const invalidate = () => qc.invalidateQueries({ queryKey: trpc.payroll.pathKey() });
  const createExport = useMutation(trpc.payroll.createExport.mutationOptions({ onSuccess: invalidate }));
  const markPaid = useMutation(trpc.payroll.markPaid.mutationOptions({ onSuccess: invalidate }));
  const [err, setErr] = useState<string | null>(null);
  const period = periods.data?.find((p) => p.id === selected);

  const exportAndDownload = async (format: "GENERIC_CSV" | "PDF") => {
    setErr(null);
    try {
      const { exportId } = await createExport.mutateAsync({ payPeriodId: selected!, format });
      await downloadFile(`/payroll-exports/${exportId}/download`, format === "PDF" ? "payroll.pdf" : "payroll.csv");
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader title="Payroll" subtitle="Approved hours and reimbursements, ready to hand to your payroll provider" />
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <Card title="Pay periods">
          {periods.isLoading ? (
            <Loading />
          ) : (
            <ul className="-mx-2 space-y-0.5">
              {periods.data?.map((p) => (
                <li key={p.id}>
                  <button onClick={() => setSelected(p.id)} className={cx("w-full rounded-md px-2 py-1.5 text-left text-sm", p.id === selected ? "bg-accent-soft text-accent-ink" : "hover:bg-surface-2")}>
                    <div className="font-medium tabular">
                      {p.start} – {p.end.slice(5)}
                    </div>
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {Object.entries(p.counts).map(([s, n]) => (
                        <span key={s} className="text-xs text-muted">
                          {n} {s.toLowerCase()}
                        </span>
                      ))}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="space-y-4">
          <ErrorText error={err ?? (markPaid.error ? errorMessage(markPaid.error) : null)} />
          {detail.data && (
            <Card
              title={`Pay period ${detail.data.period.start} – ${detail.data.period.end}`}
              actions={
                detail.data.rows.some((r) => r.status === "APPROVED") && (
                  <>
                    <Button variant="secondary" onClick={() => exportAndDownload("PDF")} disabled={createExport.isPending}>
                      Export PDF
                    </Button>
                    <Button onClick={() => exportAndDownload("GENERIC_CSV")} disabled={createExport.isPending}>
                      Export CSV
                    </Button>
                  </>
                )
              }
            >
              {detail.data.notReady.length > 0 && (
                <p className="mb-3 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-ink">
                  Not yet approved: {detail.data.notReady.map((n) => `${n.name} (${n.status.toLowerCase()})`).join(", ")}
                </p>
              )}
              {detail.data.rows.length === 0 ? (
                <Empty>No approved timesheets in this period yet.</Empty>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted">
                    <tr>
                      <th className="py-1.5">Name</th>
                      <th>Type</th>
                      <th className="text-right">Regular</th>
                      <th className="text-right">OT</th>
                      <th className="text-right">DT</th>
                      <th className="text-right">Rate</th>
                      <th className="text-right">Gross est.</th>
                      <th className="text-right">Reimburse</th>
                      <th className="pl-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.data.rows.map((r) => (
                      <tr key={r.timesheetId} className="border-t border-line-soft">
                        <td className="py-2">{r.name}</td>
                        <td className="text-xs">{r.classification === "W2" ? "W-2" : "1099"}</td>
                        <td className="text-right tabular">{r.regularHours.toFixed(2)}</td>
                        <td className={cx("text-right tabular", r.overtimeHours > 0 && "font-semibold text-warning-ink")}>{r.overtimeHours.toFixed(2)}</td>
                        <td className="text-right tabular">{r.doubleTimeHours.toFixed(2)}</td>
                        <td className="text-right">
                          <Money cents={r.hourlyRateCents} showCents />
                        </td>
                        <td className="text-right">
                          <Money cents={r.grossCents} showCents />
                        </td>
                        <td className="text-right">
                          <Money cents={r.reimbursementCents} showCents />
                        </td>
                        <td className="pl-3">
                          <StatusBadge status={r.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="mt-3 text-xs text-faint">
                Gross wages are estimates from approved hours. Your payroll provider calculates withholding, taxes and net pay. 1099 contractors are paid as vendors.
              </p>
            </Card>
          )}
          {period && period.exports.length > 0 && (
            <Card title="Exports">
              <ul className="divide-y divide-line-soft text-sm">
                {period.exports.map((e) => (
                  <li key={e.id} className="flex items-center justify-between py-2">
                    <span>
                      {e.format === "PDF" ? "PDF summary" : "CSV"} · {e.createdAt.toLocaleString()}
                      {e.paidAt && <span className="ml-2 text-good-ink">paid {e.paidAt.toLocaleDateString()}</span>}
                    </span>
                    <span className="flex gap-2">
                      <Button variant="ghost" onClick={() => downloadFile(`/payroll-exports/${e.id}/download`, "payroll").catch((x) => setErr(errorMessage(x)))}>
                        Download
                      </Button>
                      {!e.paidAt && (
                        <Button variant="secondary" onClick={() => markPaid.mutate({ exportId: e.id })}>
                          Mark paid
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
