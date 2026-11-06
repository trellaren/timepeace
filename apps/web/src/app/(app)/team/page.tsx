"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage, useTRPC, type RouterOutputs } from "@timepeace/api-client";
import {
  INVITE_TTL_DAYS,
  PAY_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLES,
  dollarsToCents,
  formatCents,
  inviteMessage,
  invitableRoles,
  type Role,
  type WorkerClassification,
} from "@timepeace/shared";
import { useState } from "react";
import { Button, Card, Empty, ErrorText, Input, Loading, PageHeader, Select, cx } from "@/components/ui";
import { getSession } from "@/lib/session";

type Member = RouterOutputs["team"]["members"][number];
type Shared = { url: string; orgName: string; inviterName: string; name: string; email: string; phone: string | null };

const CLASS_LABEL: Record<WorkerClassification, string> = { W2: "W-2 employee", CONTRACTOR_1099: "1099 contractor" };

export default function TeamPage() {
  const session = getSession()!;
  const myRole = session.role;
  const trpc = useTRPC();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: trpc.team.pathKey() });
  const members = useQuery(trpc.team.members.queryOptions());
  const invites = useQuery(trpc.team.invites.queryOptions());
  const regenerate = useMutation(trpc.team.regenerateInvite.mutationOptions({ onSuccess: invalidate }));
  const revoke = useMutation(trpc.team.revokeInvite.mutationOptions({ onSuccess: invalidate }));
  const [inviting, setInviting] = useState(false);
  const [shared, setShared] = useState<Shared | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const canInvite = invitableRoles(myRole).length > 0;

  const visible = (members.data ?? []).filter((m) => showInactive || m.active);
  const inactiveCount = (members.data ?? []).filter((m) => !m.active).length;

  return (
    <>
      <PageHeader
        title="Team"
        subtitle={myRole === "OWNER" ? "Invite people, set roles and pay, and turn off access." : "Invite field workers and manage their access."}
        actions={
          canInvite && (
            <Button
              onClick={() => {
                setShared(null);
                setInviting(!inviting);
              }}
            >
              {inviting ? "Cancel" : "Invite someone"}
            </Button>
          )
        }
      />

      <div className="space-y-6">
        {inviting && (
          <InviteForm
            myRole={myRole}
            onCreated={(s) => {
              setInviting(false);
              setShared(s);
              invalidate();
            }}
          />
        )}
        {shared && <ShareLink s={shared} onClose={() => setShared(null)} />}

        <Card title="Pending invites">
          <ErrorText error={regenerate.error ? errorMessage(regenerate.error) : revoke.error ? errorMessage(revoke.error) : null} />
          {invites.isLoading ? (
            <Loading />
          ) : !invites.data?.length ? (
            <Empty>No pending invites.</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-stone-500">
                <tr>
                  <th className="py-1.5">Person</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Invited by</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {invites.data.map((i) => (
                  <tr key={i.id} className="border-t border-stone-100">
                    <td className="py-2">
                      <div className="font-medium">{i.name}</div>
                      <div className="text-xs text-stone-500">{i.email}</div>
                    </td>
                    <td>
                      {ROLE_LABELS[i.role]}
                      {i.classification && <div className="text-xs text-stone-500">{CLASS_LABEL[i.classification]}</div>}
                    </td>
                    <td className="text-xs">
                      {i.status === "EXPIRED" ? (
                        <span className="text-amber-700">
                          <span aria-hidden>▲</span> Expired
                        </span>
                      ) : (
                        <span className="text-stone-600">
                          <span aria-hidden>○</span> Waiting · expires {new Date(i.expiresAt).toLocaleDateString()}
                        </span>
                      )}
                    </td>
                    <td className="text-xs text-stone-500">{i.invitedBy}</td>
                    <td className="space-x-1 text-right whitespace-nowrap">
                      <Button
                        variant="ghost"
                        disabled={regenerate.isPending}
                        onClick={async () => {
                          const r = await regenerate.mutateAsync({ inviteId: i.id });
                          setShared({ ...r, name: i.name, email: i.email, phone: i.phone });
                        }}
                      >
                        New link
                      </Button>
                      <Button variant="ghost" disabled={revoke.isPending} onClick={() => revoke.mutate({ inviteId: i.id })}>
                        Revoke
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-xs text-stone-400">Links work once and expire after {INVITE_TTL_DAYS} days. For security they&apos;re only shown when created; use “New link” to send another.</p>
        </Card>

        <Card
          title="Members"
          actions={
            inactiveCount > 0 && (
              <label className="flex items-center gap-2 text-sm text-stone-600">
                <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show deactivated ({inactiveCount})
              </label>
            )
          }
        >
          {members.isLoading ? <Loading /> : <MembersTable rows={visible} myRole={myRole} />}
        </Card>
      </div>
    </>
  );
}

function InviteForm({ myRole, onCreated }: { myRole: Role; onCreated: (s: Shared) => void }) {
  const trpc = useTRPC();
  const roles = invitableRoles(myRole);
  const seePay = PAY_ROLES.includes(myRole);
  const invite = useMutation(trpc.team.invite.mutationOptions());
  const [f, setF] = useState({ name: "", email: "", phone: "", role: (roles.includes("WORKER") ? "WORKER" : roles[0]) as Role, classification: "W2" as WorkerClassification, rate: "" });
  const [err, setErr] = useState<string | null>(null);
  return (
    <Card title="Invite someone">
      <form
        className="grid gap-3 md:grid-cols-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          try {
            const r = await invite.mutateAsync({
              name: f.name,
              email: f.email,
              phone: f.phone || null,
              role: f.role,
              classification: f.role === "WORKER" ? f.classification : null,
              hourlyRateCents: seePay && f.role === "WORKER" && f.rate ? dollarsToCents(f.rate) : null,
            });
            onCreated({ ...r, name: f.name, email: f.email.trim().toLowerCase(), phone: f.phone.replace(/[^\d+]/g, "") || null });
          } catch (x) {
            setErr(errorMessage(x));
          }
        }}
      >
        <Input label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoComplete="off" />
        <Input label="Email (their sign-in)" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required autoComplete="off" />
        <Input label="Mobile (optional, to text the link)" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="off" />
        <Select label="Role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })} disabled={roles.length === 1}>
          {roles.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]} — {ROLE_DESCRIPTIONS[r]}
            </option>
          ))}
        </Select>
        {f.role === "WORKER" && (
          <>
            <Select label="Classification" value={f.classification} onChange={(e) => setF({ ...f, classification: e.target.value as WorkerClassification })}>
              <option value="W2">{CLASS_LABEL.W2}</option>
              <option value="CONTRACTOR_1099">{CLASS_LABEL.CONTRACTOR_1099}</option>
            </Select>
            {seePay ? (
              <Input label="Starting pay ($/hour, optional)" inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />
            ) : (
              <p className="self-end pb-2 text-xs text-stone-500">An owner or HR sets their pay rate.</p>
            )}
          </>
        )}
        <div className="flex items-center gap-3 md:col-span-3">
          <Button type="submit" disabled={invite.isPending}>
            {invite.isPending ? "Creating…" : "Create invite link"}
          </Button>
          <ErrorText error={err} />
        </div>
      </form>
    </Card>
  );
}

function ShareLink({ s, onClose }: { s: Shared; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const msg = inviteMessage(s.orgName, s.inviterName, s.url);
  const sms = `sms:${s.phone ?? ""}?&body=${encodeURIComponent(msg)}`;
  const mail = `mailto:${s.email}?subject=${encodeURIComponent(`Join ${s.orgName} on Timepeace`)}&body=${encodeURIComponent(msg)}`;
  return (
    <Card title={`Send ${s.name} their invite`} actions={<Button variant="ghost" onClick={onClose}>Done</Button>}>
      <div className="flex flex-wrap items-end gap-2">
        <Input label="Invite link (shown once)" className="min-w-80 flex-1" readOnly value={s.url} onFocus={(e) => e.currentTarget.select()} />
        <Button
          variant="secondary"
          onClick={async () => {
            await navigator.clipboard.writeText(s.url);
            setCopied(true);
          }}
        >
          {copied ? "Copied ✓" : "Copy link"}
        </Button>
        <a href={sms} className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm hover:bg-stone-50">
          Text it
        </a>
        <a href={mail} className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm hover:bg-stone-50">
          Email it
        </a>
      </div>
      <p className="mt-2 text-xs text-stone-500">Anyone with this link can join as this person, so send it only to them. It works once and expires in {INVITE_TTL_DAYS} days.</p>
    </Card>
  );
}

function MembersTable({ rows, myRole }: { rows: Member[]; myRole: Role }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: trpc.team.pathKey() });
  const setActive = useMutation(trpc.team.setActive.mutationOptions({ onSuccess: invalidate }));
  const setRole = useMutation(trpc.team.setRole.mutationOptions({ onSuccess: invalidate }));
  const seePay = PAY_ROLES.includes(myRole);
  const [editingPay, setEditingPay] = useState<string | null>(null);
  const error = setActive.error ?? setRole.error;
  if (!rows.length) return <Empty>No members.</Empty>;
  return (
    <>
      <ErrorText error={error ? errorMessage(error) : null} />
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-stone-500">
          <tr>
            <th className="py-1.5">Person</th>
            <th>Role</th>
            {seePay && <th>Pay</th>}
            <th>Last active</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <MemberRow
              key={m.userId}
              m={m}
              myRole={myRole}
              seePay={seePay}
              editingPay={editingPay === m.userId}
              onEditPay={() => setEditingPay(editingPay === m.userId ? null : m.userId)}
              onRole={(role) => setRole.mutate({ userId: m.userId, role })}
              onActive={(active) => {
                if (!active && !confirm(`Deactivate ${m.name}? They'll be signed out and can't sign in until reactivated. Their hours and history stay.`)) return;
                setActive.mutate({ userId: m.userId, active });
              }}
              busy={setActive.isPending || setRole.isPending}
            />
          ))}
        </tbody>
      </table>
    </>
  );
}

function MemberRow(p: { m: Member; myRole: Role; seePay: boolean; editingPay: boolean; onEditPay: () => void; onRole: (r: Role) => void; onActive: (a: boolean) => void; busy: boolean }) {
  const { m } = p;
  const cols = p.seePay ? 5 : 4;
  return (
    <>
      <tr className={cx("border-t border-stone-100 align-top", !m.active && "text-stone-400")}>
        <td className="py-2">
          <div className="font-medium">
            {m.name}
            {m.isYou && <span className="ml-1 text-xs font-normal text-stone-400">(you)</span>}
            {!m.active && <span className="ml-2 rounded bg-stone-100 px-1.5 py-0.5 text-xs font-normal text-stone-600">deactivated</span>}
          </div>
          <div className="text-xs text-stone-500">
            {m.email}
            {m.phone && ` · ${m.phone}`}
          </div>
        </td>
        <td>
          {p.myRole === "OWNER" && m.canManage && m.active ? (
            <select aria-label={`Role for ${m.name}`} className="rounded border border-stone-200 bg-white px-1 py-0.5 text-sm" value={m.role} disabled={p.busy} onChange={(e) => p.onRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          ) : (
            ROLE_LABELS[m.role]
          )}
          {m.classification && m.role === "WORKER" && <div className="text-xs text-stone-500">{CLASS_LABEL[m.classification]}</div>}
        </td>
        {p.seePay && (
          <td className="whitespace-nowrap">
            {m.role === "WORKER" ? (
              <button className="text-left hover:underline" onClick={p.onEditPay} aria-label={`Edit pay for ${m.name}`}>
                {m.hourlyRateCents != null ? (
                  <span className="tabular">{formatCents(m.hourlyRateCents)}/hr</span>
                ) : (
                  <span className="text-amber-700">
                    <span aria-hidden>▲</span> No rate set
                  </span>
                )}
                {m.rateEffectiveDate && <div className="text-xs text-stone-400">since {m.rateEffectiveDate}</div>}
              </button>
            ) : (
              <span className="text-stone-400">—</span>
            )}
          </td>
        )}
        <td className="text-xs text-stone-500">{m.lastActiveAt ? new Date(m.lastActiveAt).toLocaleDateString() : "never"}</td>
        <td className="text-right">
          {m.canManage &&
            (m.active ? (
              <Button variant="ghost" disabled={p.busy} onClick={() => p.onActive(false)}>
                Deactivate
              </Button>
            ) : (
              <Button variant="ghost" disabled={p.busy} onClick={() => p.onActive(true)}>
                Reactivate
              </Button>
            ))}
        </td>
      </tr>
      {p.editingPay && (
        <tr>
          <td colSpan={cols} className="bg-stone-50 p-3">
            <PayForm m={m} onDone={p.onEditPay} />
          </td>
        </tr>
      )}
    </>
  );
}

function PayForm({ m, onDone }: { m: Member; onDone: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const save = useMutation(trpc.org.setPayRate.mutationOptions({ onSuccess: () => qc.invalidateQueries({ queryKey: trpc.team.pathKey() }) }));
  const [f, setF] = useState({
    classification: (m.classification ?? "W2") as WorkerClassification,
    rate: m.hourlyRateCents != null ? String(m.hourlyRateCents / 100) : "",
    burden: String((m.burdenBps ?? 2500) / 100),
    effectiveDate: new Date().toISOString().slice(0, 10),
  });
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        await save.mutateAsync({
          userId: m.userId,
          classification: f.classification,
          hourlyRateCents: dollarsToCents(f.rate),
          burdenBps: Math.round(Number(f.burden) * 100),
          effectiveDate: f.effectiveDate,
        });
        onDone();
      }}
    >
      <Select label="Classification" value={f.classification} onChange={(e) => setF({ ...f, classification: e.target.value as WorkerClassification })}>
        <option value="W2">{CLASS_LABEL.W2}</option>
        <option value="CONTRACTOR_1099">{CLASS_LABEL.CONTRACTOR_1099}</option>
      </Select>
      <Input label="Rate ($/hour)" className="w-28" inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} required />
      <Input label="Labor burden (%)" className="w-28" inputMode="decimal" value={f.burden} onChange={(e) => setF({ ...f, burden: e.target.value })} />
      <Input label="Effective from" type="date" value={f.effectiveDate} onChange={(e) => setF({ ...f, effectiveDate: e.target.value })} required />
      <Button type="submit" disabled={save.isPending}>
        Save pay
      </Button>
      <ErrorText error={save.error ? errorMessage(save.error) : null} />
      <p className="w-full text-xs text-stone-500">Hours on or after the effective date use the new rate. Earlier hours keep the old one.</p>
    </form>
  );
}
