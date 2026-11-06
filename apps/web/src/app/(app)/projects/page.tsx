"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage, useTRPC } from "@timepeace/api-client";
import { CONTRACT_TYPES, dollarsToCents } from "@timepeace/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSession } from "@/components/AppShell";
import { Button, Card, ErrorText, Input, Loading, Money, PageHeader, Select, StatusBadge } from "@/components/ui";
import { can } from "@/lib/session";

export default function ProjectsPage() {
  const trpc = useTRPC();
  const session = useSession();
  const { data, isLoading } = useQuery(trpc.projects.list.queryOptions());
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        title="Projects"
        actions={can.manage(session?.role) && <Button onClick={() => setCreating((v) => !v)}>{creating ? "Cancel" : "New project"}</Button>}
      />
      {creating && <NewProjectForm />}
      {isLoading ? (
        <Loading />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data?.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="rounded-lg border border-line bg-surface p-4 hover:border-accent">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-ink">{p.name}</div>
                  <div className="text-xs text-muted">
                    {p.client?.name} · {p.projectType ?? "—"}
                  </div>
                </div>
                <StatusBadge status={p.status} />
              </div>
              <div className="mt-3 flex items-center justify-between text-sm text-ink-2">
                <span>
                  {p.taskCounts.done}/{p.taskCounts.total} tasks done
                  {p.taskCounts.blocked > 0 && <span className="ml-2 text-warning-ink">· {p.taskCounts.blocked} waiting</span>}
                </span>
                <span>
                  <Money cents={p.contractValueCents} /> <span className="text-xs text-faint">{p.contractType.replace(/_/g, " ").toLowerCase()}</span>
                </span>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-surface-3">
                <div className="h-1.5 rounded-full bg-accent" style={{ width: `${p.taskCounts.total ? (p.taskCounts.done / p.taskCounts.total) * 100 : 0}%` }} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

function NewProjectForm() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const router = useRouter();
  const templates = useQuery(trpc.org.templates.queryOptions());
  const create = useMutation(trpc.projects.create.mutationOptions());
  const [f, setF] = useState({ name: "", clientName: "", address: "", templateId: "", contractType: "FIXED", contractValue: "", markup: "", startDate: "" });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  return (
    <Card title="New project" className="mb-6">
      <form
        className="grid gap-3 md:grid-cols-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          try {
            const p = await create.mutateAsync({
              name: f.name,
              clientName: f.clientName || null,
              address: f.address || null,
              templateId: f.templateId || null,
              contractType: f.contractType as (typeof CONTRACT_TYPES)[number],
              contractValueCents: f.contractValue ? dollarsToCents(f.contractValue) : 0,
              markupBps: f.markup ? Math.round(Number(f.markup) * 100) : null,
              startDate: f.startDate || null,
            });
            await qc.invalidateQueries({ queryKey: trpc.projects.list.queryKey() });
            router.push(`/projects/${p.id}`);
          } catch (e) {
            setErr(errorMessage(e));
          }
        }}
      >
        <Input label="Project name" value={f.name} onChange={set("name")} required placeholder="e.g. Aspen Ct Lot 3" />
        <Input label="Client" value={f.clientName} onChange={set("clientName")} placeholder="New client name" />
        <Input label="Site address" value={f.address} onChange={set("address")} />
        <Select label="Start from template" value={f.templateId} onChange={set("templateId")}>
          <option value="">Blank project</option>
          {templates.data?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <Select label="Contract type" value={f.contractType} onChange={set("contractType")}>
          <option value="FIXED">Fixed price</option>
          <option value="COST_PLUS">Cost plus</option>
          <option value="T_AND_M">Time & materials</option>
        </Select>
        {f.contractType === "FIXED" ? (
          <Input label="Contract value ($)" inputMode="decimal" value={f.contractValue} onChange={set("contractValue")} placeholder="350000" />
        ) : (
          <Input label="Markup on cost (%)" inputMode="decimal" value={f.markup} onChange={set("markup")} placeholder="15" />
        )}
        <Input label="Start date" type="date" value={f.startDate} onChange={set("startDate")} />
        <div className="flex items-end md:col-span-2">
          <Button type="submit" disabled={create.isPending}>
            Create project
          </Button>
        </div>
        <div className="md:col-span-3">
          <ErrorText error={err} />
        </div>
      </form>
    </Card>
  );
}
