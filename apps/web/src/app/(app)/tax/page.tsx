"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage, useTRPC, type RouterOutputs } from "@timepeace/api-client";
import {
  PAYMENT_METHODS,
  TAX_CATEGORIES,
  VENDOR_TAX_CLASSES,
  VENDOR_TAX_CLASS_LABELS,
  dollarsToCents,
  formatCents,
  type PaymentMethod,
  type VendorTaxClass,
} from "@timepeace/shared";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useState } from "react";
import { Button, Card, Empty, ErrorText, Input, Loading, Money, PageHeader, Select, cx } from "@/components/ui";
import { downloadFile } from "@/lib/trpc";

type Tab = "overview" | "deductions" | "1099" | "mileage" | "estimates";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "deductions", label: "Deductions" },
  { id: "1099", label: "1099-NEC" },
  { id: "mileage", label: "Mileage" },
  { id: "estimates", label: "Estimated taxes" },
];

export default function TaxPage() {
  return (
    <Suspense fallback={<Loading />}>
      <TaxCenter />
    </Suspense>
  );
}

function TaxCenter() {
  const params = useSearchParams();
  const router = useRouter();
  const thisYear = new Date().getFullYear();
  const year = Number(params.get("year") ?? thisYear);
  const tab = (params.get("tab") as Tab) ?? "overview";
  const go = (t: Tab, y = year) => router.replace(`/tax?tab=${t}&year=${y}`);
  const [err, setErr] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title="Tax center"
        subtitle="Organizes your records for your CPA. Not tax advice, and nothing here is filed for you."
        actions={
          <>
            <Select aria-label="Tax year" value={String(year)} onChange={(e) => go(tab, Number(e.target.value))}>
              {[thisYear, thisYear - 1, thisYear - 2].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
            <Button
              onClick={() => {
                setErr(null);
                downloadFile(`/tax/${year}/cpa-package.zip`, `tax_package_${year}.zip`).catch((e) => setErr(errorMessage(e)));
              }}
            >
              Download CPA package
            </Button>
          </>
        }
      />
      <ErrorText error={err} />
      <div className="mb-4 flex gap-1 border-b border-stone-200">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => go(t.id)} className={cx("-mb-px border-b-2 px-4 py-2 text-sm", tab === t.id ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-stone-500 hover:text-stone-800")}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "overview" && <Overview year={year} onOpen={(t) => go(t)} />}
      {tab === "deductions" && <Deductions year={year} />}
      {tab === "1099" && <Form1099 year={year} />}
      {tab === "mileage" && <Mileage year={year} />}
      {tab === "estimates" && <Estimates year={year} />}
    </>
  );
}

/* ───────────── Overview ───────────── */

function Overview({ year, onOpen }: { year: number; onOpen: (t: Tab) => void }) {
  const trpc = useTRPC();
  const { data: s, isLoading } = useQuery(trpc.tax.summary.queryOptions({ year }));
  if (isLoading || !s) return <Loading />;
  const formName = s.form === "scheduleC" ? "Schedule C" : s.form === "form1120S" ? "Form 1120-S" : "your return";
  const cogs = s.lines.filter((l) => l.costOfGoodsSold);
  const deductions = s.lines.filter((l) => !l.costOfGoodsSold && !l.capitalize);
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: "Revenue received (cash basis)", v: s.revenue.receivedCents, sub: `invoiced ${formatCents(s.revenue.invoicedCents, { showCents: false })}` },
          { label: "Cost of goods sold", v: s.cogsCents },
          { label: "Other deductions", v: s.deductionsCents },
          { label: "Net profit (estimate)", v: s.netProfitCents },
        ].map((t) => (
          <div key={t.label} className="rounded-lg border border-stone-200 bg-white p-4">
            <div className="text-xs text-stone-500">{t.label}</div>
            <div className={cx("mt-1 text-xl font-semibold", t.v < 0 && "text-red-700")}>
              <Money cents={t.v} />
            </div>
            {t.sub && <div className="text-xs text-stone-400">{t.sub}</div>}
          </div>
        ))}
      </div>

      {s.flags.length > 0 && (
        <Card title="Needs attention">
          <ul className="space-y-1.5 text-sm">
            {s.flags.map((f, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden className={f.level === "warn" ? "text-amber-600" : "text-brand-600"}>
                  {f.level === "warn" ? "▲" : "ℹ︎"}
                </span>
                <span>{f.message}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Cost of goods sold (${s.form === "scheduleC" ? "Schedule C Part III" : s.form === "form1120S" ? "Form 1125-A" : "COGS"})`}>
          <LineTable rows={cogs} total={s.cogsCents} onOpen={() => onOpen("deductions")} />
        </Card>
        <Card title={`Deductions by ${formName} line`}>
          <LineTable rows={deductions} total={s.deductionsCents} onOpen={() => onOpen("deductions")} />
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Payroll (from approved timesheets)">
          <dl className="space-y-1 text-sm">
            <Row k="W-2 wages (gross estimate)" v={<Money cents={s.payroll.w2WagesCents} />} />
            <Row k="1099 contractors via payroll" v={<Money cents={s.payroll.contractorPayCents} />} />
          </dl>
          <p className="mt-2 text-xs text-stone-400">Employer payroll taxes and benefits come from your payroll provider&apos;s reports.</p>
        </Card>
        <Card title="Vehicle (standard mileage)" actions={<Button variant="ghost" onClick={() => onOpen("mileage")}>Log →</Button>}>
          <dl className="space-y-1 text-sm">
            <Row k="Business miles" v={<span className="tabular">{s.mileage.miles.toLocaleString()}</span>} />
            <Row k="Rate" v={<span className="tabular">{(s.mileage.rateMilliCents / 100).toFixed(1)}¢/mi</span>} />
            <Row k="Deduction" v={<Money cents={s.mileage.deductionCents} />} />
          </dl>
        </Card>
        <Card title="Capital purchases & sales tax">
          {s.capitalPurchases.length === 0 ? (
            <p className="text-sm text-stone-500">No equipment purchases this year.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {s.capitalPurchases.map((c) => (
                <li key={c.id} className="flex justify-between gap-2">
                  <span>
                    {c.spentOn} · {c.vendorName}
                    {c.note && <span className="text-stone-500"> · {c.note}</span>}
                  </span>
                  <Money cents={c.amountCents} />
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-stone-400">Depreciation vs §179 / bonus expensing is your CPA&apos;s call; not included in deductions above.</p>
          <div className="mt-3 border-t border-stone-100 pt-2 text-sm">
            Sales tax paid on purchases: <Money cents={s.salesTaxPaidCents} showCents />
          </div>
        </Card>
      </div>
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex justify-between gap-2">
    <dt className="text-stone-600">{k}</dt>
    <dd>{v}</dd>
  </div>
);

function LineTable({ rows, total, onOpen }: { rows: RouterOutputs["tax"]["summary"]["lines"]; total: number; onOpen: () => void }) {
  if (!rows.length) return <Empty>Nothing recorded yet.</Empty>;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-stone-500">
        <tr>
          <th className="py-1">Category</th>
          <th>Line</th>
          <th className="text-right">Items</th>
          <th className="text-right">Deductible</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((l) => (
          <tr key={l.id} className="cursor-pointer border-t border-stone-100 hover:bg-stone-50" onClick={onOpen}>
            <td className="py-1.5">
              {l.label}
              {l.missingReceipts > 0 && <span className="ml-1 text-xs text-amber-700">· {l.missingReceipts} missing receipt</span>}
              {l.amountCents !== l.deductibleCents && <div className="text-xs text-stone-400">of {formatCents(l.amountCents)} spent</div>}
            </td>
            <td className="text-xs text-stone-500">{l.formLine ?? "—"}</td>
            <td className="text-right tabular">{l.count}</td>
            <td className="text-right">
              <Money cents={l.deductibleCents} />
            </td>
          </tr>
        ))}
        <tr className="border-t-2 border-stone-200 font-semibold">
          <td className="py-1.5" colSpan={3}>
            Total
          </td>
          <td className="text-right">
            <Money cents={total} />
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/* ───────────── Deductions (expense detail) ───────────── */

function Deductions({ year }: { year: number }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");
  const { data, isLoading } = useQuery(trpc.tax.expenses.queryOptions({ year, taxCategory: filter || undefined }));
  const update = useMutation(trpc.tax.setExpenseTax.mutationOptions({ onSuccess: () => qc.invalidateQueries({ queryKey: trpc.tax.pathKey() }) }));
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <Select label="Category" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All categories</option>
          {TAX_CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>
        <Button variant="secondary" onClick={() => setAdding(!adding)}>
          {adding ? "Cancel" : "+ Company expense"}
        </Button>
      </div>
      {adding && <AddOverhead year={year} onDone={() => setAdding(false)} />}
      <ErrorText error={update.error ? errorMessage(update.error) : null} />
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <Empty>No expenses.</Empty>
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-stone-500">
              <tr>
                <th className="py-1.5">Date</th>
                <th>Vendor</th>
                <th>Job</th>
                <th className="text-right">Amount</th>
                <th className="pl-3">Tax category</th>
                <th>Paid via</th>
                <th>Receipt</th>
              </tr>
            </thead>
            <tbody>
              {data.map((e) => (
                <tr key={e.id} className="border-t border-stone-100 align-top">
                  <td className="py-1.5 tabular whitespace-nowrap">{e.spentOn}</td>
                  <td>
                    {e.vendorName}
                    {e.note && <div className="text-xs text-stone-500">{e.note}</div>}
                  </td>
                  <td className="text-xs">{e.projectName ?? <span className="text-stone-400">Overhead</span>}</td>
                  <td className="text-right">
                    <Money cents={e.amountCents} showCents />
                    {e.deductibleCents !== e.amountCents && <div className="text-xs text-stone-400">deductible {formatCents(e.deductibleCents)}</div>}
                  </td>
                  <td className="pl-3">
                    <select
                      aria-label="Tax category"
                      className={cx("max-w-56 rounded border bg-white px-1 py-0.5 text-xs", e.taxCategory === "other" ? "border-amber-400" : "border-stone-200")}
                      value={e.taxCategory}
                      onChange={(ev) => update.mutate({ expenseId: e.id, taxCategory: ev.target.value })}
                    >
                      {TAX_CATEGORIES.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {e.paidBy === "PERSONAL" ? (
                      <span className="text-xs text-stone-500">employee (reimbursed)</span>
                    ) : (
                      <select
                        aria-label="Payment method"
                        className="rounded border border-stone-200 bg-white px-1 py-0.5 text-xs"
                        value={e.paymentMethod ?? ""}
                        onChange={(ev) => update.mutate({ expenseId: e.id, paymentMethod: (ev.target.value || null) as PaymentMethod | null })}
                      >
                        <option value="">— not recorded</option>
                        {PAYMENT_METHODS.map((m) => (
                          <option key={m} value={m}>
                            {m.toLowerCase()}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="text-xs">{e.hasReceipt ? "🧾" : e.amountCents >= 75_00 ? <span className="text-amber-700">missing</span> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function AddOverhead({ year, onDone }: { year: number; onDone: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const add = useMutation(trpc.tax.addExpense.mutationOptions({ onSuccess: () => qc.invalidateQueries({ queryKey: trpc.tax.pathKey() }) }));
  const [f, setF] = useState({ spentOn: `${year}-01-01`, vendorName: "", amount: "", taxCategory: "insurance", paymentMethod: "ACH", note: "" });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Card title="Company expense (not from the field)">
      <form
        className="grid gap-3 md:grid-cols-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          try {
            await add.mutateAsync({ spentOn: f.spentOn, vendorName: f.vendorName, amountCents: dollarsToCents(f.amount), taxCategory: f.taxCategory, paymentMethod: (f.paymentMethod || null) as PaymentMethod | null, note: f.note || null });
            onDone();
          } catch (x) {
            setErr(errorMessage(x));
          }
        }}
      >
        <Input label="Date" type="date" value={f.spentOn} onChange={set("spentOn")} required />
        <Input label="Paid to" value={f.vendorName} onChange={set("vendorName")} required placeholder="e.g. Pinnacle Insurance" />
        <Input label="Amount ($)" inputMode="decimal" value={f.amount} onChange={set("amount")} required />
        <Select label="Tax category" value={f.taxCategory} onChange={set("taxCategory")}>
          {TAX_CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>
        <Select label="Paid via" value={f.paymentMethod} onChange={set("paymentMethod")}>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {m.toLowerCase()}
            </option>
          ))}
        </Select>
        <Input label="Note" value={f.note} onChange={set("note")} />
        <div className="md:col-span-3">
          <ErrorText error={err} />
          <Button type="submit" disabled={add.isPending}>
            Add expense
          </Button>
        </div>
      </form>
    </Card>
  );
}

/* ───────────── 1099-NEC ───────────── */

const STATUS_1099: Record<string, { label: string; cls: string }> = {
  FILE: { label: "File 1099-NEC", cls: "bg-brand-50 text-brand-700" },
  BELOW_THRESHOLD: { label: "Below threshold", cls: "bg-stone-100 text-stone-600" },
  EXEMPT_CORPORATION: { label: "Exempt (corporation)", cls: "bg-stone-100 text-stone-600" },
  NOT_SERVICE_VENDOR: { label: "Goods vendor", cls: "bg-stone-100 text-stone-500" },
};

function Form1099({ year }: { year: number }) {
  const trpc = useTRPC();
  const { data, isLoading } = useQuery(trpc.tax.vendors1099.queryOptions({ year }));
  const summary = useQuery(trpc.tax.summary.queryOptions({ year }));
  const [editing, setEditing] = useState<string | null>(null);
  if (isLoading || !data) return <Loading />;
  const filing = data.filter((r) => r.status === "FILE");
  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-600">
        Threshold for {year}: <strong>{summary.data ? formatCents(summary.data.settings.form1099ThresholdCents, { showCents: false }) : "…"}</strong>. Payments by card or
        payment apps are excluded (the processor reports them on 1099-K). Corporations are exempt except attorneys. {filing.length} vendor(s) need a 1099-NEC; due to
        recipients and the IRS by January 31.
      </p>
      <Card>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-stone-500">
            <tr>
              <th className="py-1.5">Vendor</th>
              <th>Status</th>
              <th className="text-right">Box 1 (reportable)</th>
              <th className="text-right">Card (excluded)</th>
              <th className="pl-3">W-9</th>
              <th>Issues</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <Fragment key={r.vendor.id}>
                <tr className="border-t border-stone-100 align-top">
                  <td className="py-2">
                    <div className="font-medium">{r.vendor.name}</div>
                    <div className="text-xs text-stone-500">{r.vendor.taxClassification ? VENDOR_TAX_CLASS_LABELS[r.vendor.taxClassification as VendorTaxClass] : "classification unknown"}</div>
                  </td>
                  <td>
                    <span className={cx("rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", STATUS_1099[r.status]!.cls)}>{STATUS_1099[r.status]!.label}</span>
                  </td>
                  <td className="text-right">
                    <Money cents={r.reportableCents} showCents />
                  </td>
                  <td className="text-right text-stone-500">{r.excludedCardCents ? <Money cents={r.excludedCardCents} showCents /> : "—"}</td>
                  <td className="pl-3 text-xs whitespace-nowrap">
                    {r.vendor.w9OnFile ? (
                      <span>
                        ✓ on file{r.vendor.tinLast4 && <span className="text-stone-500"> · ***{r.vendor.tinLast4}</span>}
                      </span>
                    ) : (
                      <span className="text-amber-700">missing</span>
                    )}
                  </td>
                  <td className="text-xs text-amber-800">
                    {r.issues.map((i) => (
                      <div key={i}>▲ {i}</div>
                    ))}
                  </td>
                  <td className="text-right">
                    <Button variant="ghost" onClick={() => setEditing(editing === r.vendor.id ? null : r.vendor.id)}>
                      {editing === r.vendor.id ? "Close" : "W-9"}
                    </Button>
                  </td>
                </tr>
                {editing === r.vendor.id && (
                  <tr>
                    <td colSpan={7} className="bg-stone-50 p-3">
                      <VendorW9Form vendor={r.vendor} onDone={() => setEditing(null)} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function VendorW9Form({ vendor, onDone }: { vendor: RouterOutputs["tax"]["vendors1099"][number]["vendor"]; onDone: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const update = useMutation(trpc.tax.updateVendor.mutationOptions({ onSuccess: () => qc.invalidateQueries({ queryKey: trpc.tax.pathKey() }) }));
  const [f, setF] = useState({
    is1099Eligible: vendor.is1099Eligible,
    w9OnFile: vendor.w9OnFile,
    w9ReceivedOn: vendor.w9ReceivedOn ?? "",
    taxClassification: vendor.taxClassification ?? "",
    isAttorney: vendor.isAttorney,
    tin: "",
    address: vendor.address ?? "",
    email: vendor.email ?? "",
  });
  return (
    <form
      className="grid gap-3 md:grid-cols-4"
      onSubmit={async (e) => {
        e.preventDefault();
        await update.mutateAsync({
          vendorId: vendor.id,
          is1099Eligible: f.is1099Eligible,
          w9OnFile: f.w9OnFile,
          w9ReceivedOn: f.w9ReceivedOn || null,
          taxClassification: (f.taxClassification || null) as VendorTaxClass | null,
          isAttorney: f.isAttorney,
          ...(f.tin ? { tin: f.tin } : {}),
          address: f.address || null,
          email: f.email || null,
        });
        onDone();
      }}
    >
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.is1099Eligible} onChange={(e) => setF({ ...f, is1099Eligible: e.target.checked })} /> Provides services (1099 candidate)
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.w9OnFile} onChange={(e) => setF({ ...f, w9OnFile: e.target.checked })} /> W-9 on file
      </label>
      <Input label="W-9 received" type="date" value={f.w9ReceivedOn} onChange={(e) => setF({ ...f, w9ReceivedOn: e.target.value })} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.isAttorney} onChange={(e) => setF({ ...f, isAttorney: e.target.checked })} /> Attorney / legal services
      </label>
      <Select label="Tax classification (W-9 line 3)" value={f.taxClassification} onChange={(e) => setF({ ...f, taxClassification: e.target.value })}>
        <option value="">Unknown</option>
        {VENDOR_TAX_CLASSES.map((c) => (
          <option key={c} value={c}>
            {VENDOR_TAX_CLASS_LABELS[c]}
          </option>
        ))}
      </Select>
      <Input label={`SSN / EIN${vendor.tinLast4 ? ` (on file: ***${vendor.tinLast4})` : ""}`} value={f.tin} onChange={(e) => setF({ ...f, tin: e.target.value })} placeholder="9 digits; stored encrypted" autoComplete="off" />
      <Input label="Mailing address" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
      <Input label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      <div className="flex items-center gap-3 md:col-span-4">
        <Button type="submit" disabled={update.isPending}>
          Save
        </Button>
        <ErrorText error={update.error ? errorMessage(update.error) : null} />
      </div>
    </form>
  );
}

/* ───────────── Mileage ───────────── */

function Mileage({ year }: { year: number }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery(trpc.tax.mileage.queryOptions({ year }));
  const projects = useQuery(trpc.projects.list.queryOptions());
  const invalidate = () => qc.invalidateQueries({ queryKey: trpc.tax.pathKey() });
  const add = useMutation(trpc.tax.addMileage.mutationOptions({ onSuccess: invalidate }));
  const del = useMutation(trpc.tax.deleteMileage.mutationOptions({ onSuccess: invalidate }));
  const [f, setF] = useState({ date: new Date().toISOString().slice(0, 10), miles: "", purpose: "", projectId: "" });
  if (isLoading || !data) return <Loading />;
  const total = data.rows.reduce((a, r) => a + r.miles, 0);
  return (
    <div className="space-y-4">
      <Card title="Log a trip">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            await add.mutateAsync({ date: f.date, miles: Number(f.miles), purpose: f.purpose, projectId: f.projectId || null });
            setF({ ...f, miles: "", purpose: "" });
          }}
        >
          <Input label="Date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required />
          <Input label="Miles" className="w-24" inputMode="decimal" value={f.miles} onChange={(e) => setF({ ...f, miles: e.target.value })} required />
          <Input label="Business purpose" className="min-w-64 flex-1" value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} required placeholder="e.g. Supply run for Maple Ridge" />
          <Select label="Job" value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}>
            <option value="">None</option>
            {projects.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Button type="submit" disabled={add.isPending}>
            Add
          </Button>
        </form>
        <ErrorText error={add.error ? errorMessage(add.error) : null} />
      </Card>
      <Card title={`${total.toLocaleString(undefined, { maximumFractionDigits: 1 })} business miles × ${(data.rateMilliCents / 100).toFixed(1)}¢ = ${formatCents(Math.round((total * data.rateMilliCents) / 100))}`}>
        {data.rows.length === 0 ? (
          <Empty>No trips logged for {year}.</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-stone-500">
              <tr>
                <th className="py-1">Date</th>
                <th>Driver</th>
                <th>Purpose</th>
                <th>Job</th>
                <th className="text-right">Miles</th>
                <th className="text-right">Deduction</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="border-t border-stone-100">
                  <td className="py-1.5 tabular">{r.date}</td>
                  <td>{r.user.name}</td>
                  <td>{r.purpose}</td>
                  <td className="text-xs">{r.project?.name ?? "—"}</td>
                  <td className="text-right tabular">{r.miles}</td>
                  <td className="text-right">
                    <Money cents={r.deductionCents} showCents />
                  </td>
                  <td className="text-right">
                    <Button variant="ghost" onClick={() => del.mutate({ id: r.id })} aria-label="Delete trip">
                      ×
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-3 text-xs text-stone-400">Keep date, miles, and business purpose for each trip. If you use the standard rate for a vehicle, don&apos;t also deduct its fuel and repairs.</p>
      </Card>
    </div>
  );
}

/* ───────────── Estimated taxes ───────────── */

const Q_STATUS: Record<string, { icon: string; label: string; cls: string }> = {
  PAID: { icon: "✓", label: "Covered", cls: "text-green-700" },
  SHORT: { icon: "✕", label: "Short", cls: "text-red-700" },
  DUE_SOON: { icon: "▲", label: "Due soon", cls: "text-amber-700" },
  UPCOMING: { icon: "○", label: "Upcoming", cls: "text-stone-500" },
};

function Estimates({ year }: { year: number }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery(trpc.tax.estimates.queryOptions({ year }));
  const invalidate = () => qc.invalidateQueries({ queryKey: trpc.tax.pathKey() });
  const addPay = useMutation(trpc.tax.addEstimatePayment.mutationOptions({ onSuccess: invalidate }));
  const delPay = useMutation(trpc.tax.deleteEstimatePayment.mutationOptions({ onSuccess: invalidate }));
  const settings = useMutation(trpc.tax.updateSettings.mutationOptions({ onSuccess: invalidate }));
  const [pay, setPay] = useState({ quarter: "1", amount: "", paidOn: new Date().toISOString().slice(0, 10) });
  if (isLoading || !data) return <Loading />;
  const w = data.worksheet;
  const sCorp = data.entityType === "S_CORP" || data.entityType === "C_CORP" || data.entityType === "PARTNERSHIP";

  return (
    <div className="space-y-4">
      {sCorp && (
        <p className="rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-700">
          For a {data.entityType.replace("_", " ").toLowerCase()}, owners usually make estimated payments personally on their share of profit. Use this as a planning
          worksheet with your CPA.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: `Net profit to date (as of ${data.asOf})`, v: formatCents(data.ytdNetProfitCents, { showCents: false }) },
          { label: `Projected for ${year} (${Math.round(w.yearFraction * 100)}% of year elapsed)`, v: formatCents(w.projectedAnnualProfitCents, { showCents: false }) },
          { label: `Projected tax at ${(data.settings.estimatedTaxRateBps / 100).toFixed(1)}%`, v: formatCents(w.projectedTaxCents, { showCents: false }) },
          { label: w.method === "PRIOR_YEAR_SAFE_HARBOR" ? "Required (prior-year safe harbor)" : "Required (90% of current year)", v: formatCents(w.requiredAnnualCents, { showCents: false }) },
        ].map((t) => (
          <div key={t.label} className="rounded-lg border border-stone-200 bg-white p-4">
            <div className="text-xs text-stone-500">{t.label}</div>
            <div className="mt-1 text-xl font-semibold tabular">{t.v}</div>
          </div>
        ))}
      </div>

      <Card title="Quarterly payments">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-stone-500">
            <tr>
              <th className="py-1.5">Quarter</th>
              <th>Due</th>
              <th className="text-right">Installment</th>
              <th className="text-right">Paid</th>
              <th className="text-right">Cumulative required</th>
              <th className="text-right">Cumulative paid</th>
              <th className="pl-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {w.quarters.map((q) => (
              <tr key={q.quarter} className="border-t border-stone-100">
                <td className="py-1.5">Q{q.quarter}</td>
                <td className="tabular">{q.dueDate}</td>
                <td className="text-right"><Money cents={q.installmentCents} /></td>
                <td className="text-right"><Money cents={q.paidCents} /></td>
                <td className="text-right"><Money cents={q.cumulativeRequiredCents} /></td>
                <td className="text-right"><Money cents={q.cumulativePaidCents} /></td>
                <td className="pl-3">
                  <span className={cx("text-xs font-medium", Q_STATUS[q.status]!.cls)}>
                    <span aria-hidden>{Q_STATUS[q.status]!.icon}</span> {Q_STATUS[q.status]!.label}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-stone-400">
          Required = the lower of 90% of projected {year} tax ({formatCents(w.methods.current90, { showCents: false })}) or{" "}
          {w.methods.priorYearSafeHarbor != null
            ? `${data.settings.priorYearAgiOver150k ? "110" : "100"}% of last year's tax (${formatCents(w.methods.priorYearSafeHarbor, { showCents: false })})`
            : "last year's tax (enter it below)"}
          . Projection annualizes profit to date; seasonal businesses may qualify for the annualized-income method (Form 2210). Due dates shift to the next business day
          on weekends and holidays.
        </p>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Payments made">
          <form
            className="mb-3 flex flex-wrap items-end gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              await addPay.mutateAsync({ year, quarter: Number(pay.quarter), amountCents: dollarsToCents(pay.amount), paidOn: pay.paidOn });
              setPay({ ...pay, amount: "" });
            }}
          >
            <Select label="Quarter" value={pay.quarter} onChange={(e) => setPay({ ...pay, quarter: e.target.value })}>
              {[1, 2, 3, 4].map((q) => (
                <option key={q} value={q}>
                  Q{q}
                </option>
              ))}
            </Select>
            <Input label="Amount ($)" className="w-32" inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} required />
            <Input label="Paid on" type="date" value={pay.paidOn} onChange={(e) => setPay({ ...pay, paidOn: e.target.value })} required />
            <Button type="submit" variant="secondary">
              Record
            </Button>
          </form>
          <ul className="divide-y divide-stone-100 text-sm">
            {data.payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-1.5">
                <span>
                  Q{p.quarter} · {p.paidOn}
                </span>
                <span className="flex items-center gap-2">
                  <Money cents={p.amountCents} />
                  <Button variant="ghost" aria-label="Delete payment" onClick={() => delPay.mutate({ id: p.id })}>
                    ×
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title={`${year} assumptions (set with your CPA)`}>
          <SettingsForm year={year} s={data.settings} save={(v) => settings.mutate({ year, ...v })} busy={settings.isPending} />
          <ErrorText error={settings.error ? errorMessage(settings.error) : null} />
        </Card>
      </div>
    </div>
  );
}

function SettingsForm({
  year,
  s,
  save,
  busy,
}: {
  year: number;
  s: RouterOutputs["tax"]["estimates"]["settings"];
  save: (v: { estimatedTaxRateBps: number; priorYearTaxCents: number | null; priorYearAgiOver150k: boolean; mileageRateMilliCents: number; form1099ThresholdCents: number }) => void;
  busy: boolean;
}) {
  const [f, setF] = useState({
    rate: String(s.estimatedTaxRateBps / 100),
    prior: s.priorYearTaxCents != null ? String(s.priorYearTaxCents / 100) : "",
    agi: s.priorYearAgiOver150k,
    mileage: String(s.mileageRateMilliCents / 100),
    threshold: String(s.form1099ThresholdCents / 100),
  });
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        save({
          estimatedTaxRateBps: Math.round(Number(f.rate) * 100),
          priorYearTaxCents: f.prior ? dollarsToCents(f.prior) : null,
          priorYearAgiOver150k: f.agi,
          mileageRateMilliCents: Math.round(Number(f.mileage) * 100),
          form1099ThresholdCents: dollarsToCents(f.threshold),
        });
      }}
    >
      <Input label="Effective tax rate on profit (%)" inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />
      <Input label={`${year - 1} total tax ($)`} inputMode="decimal" value={f.prior} onChange={(e) => setF({ ...f, prior: e.target.value })} placeholder="for safe harbor" />
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" checked={f.agi} onChange={(e) => setF({ ...f, agi: e.target.checked })} /> {year - 1} AGI over $150,000 (safe harbor becomes 110%)
      </label>
      <Input label={`IRS mileage rate ${year} (¢/mile)`} inputMode="decimal" value={f.mileage} onChange={(e) => setF({ ...f, mileage: e.target.value })} />
      <Input label={`1099-NEC threshold ${year} ($)`} inputMode="decimal" value={f.threshold} onChange={(e) => setF({ ...f, threshold: e.target.value })} />
      <div className="sm:col-span-2">
        <Button type="submit" variant="secondary" disabled={busy}>
          Save assumptions
        </Button>
      </div>
    </form>
  );
}
