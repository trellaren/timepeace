"use client";

import { formatCents, formatMinutes, type BudgetAlert } from "@timepeace/shared";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Button({ variant = "primary", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-accent text-on-accent hover:bg-accent-strong",
        variant === "secondary" && "border border-line-strong bg-surface text-ink hover:bg-surface-2",
        variant === "danger" && "border border-critical-line bg-surface text-critical-ink hover:bg-critical-soft",
        variant === "ghost" && "text-ink-2 hover:bg-surface-3",
        className,
      )}
    />
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-lg border border-line bg-surface", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-line-soft px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Input({ label, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <label className={cx("flex flex-col gap-1 text-sm", className)}>
      {label && <span className="text-ink-2">{label}</span>}
      <input {...props} className="rounded-md border border-line-strong px-2.5 py-1.5 outline-none focus:border-accent focus:ring-2 focus:ring-accent-ring" />
    </label>
  );
}

export function Select({ label, className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <label className={cx("flex flex-col gap-1 text-sm", className)}>
      {label && <span className="text-ink-2">{label}</span>}
      <select {...props} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 outline-none focus:border-accent">
        {children}
      </select>
    </label>
  );
}

const STATUS_STYLES: Record<string, string> = {
  TODO: "bg-surface-3 text-ink-2",
  IN_PROGRESS: "bg-accent-soft text-accent-ink",
  NEEDS_MATERIALS: "bg-warning-soft text-warning-ink",
  BLOCKED: "bg-critical-soft text-critical-ink",
  DONE: "bg-good-soft text-good-ink",
  VERIFIED: "bg-good-soft-2 text-good-ink",
  PLANNING: "bg-surface-3 text-ink-2",
  ACTIVE: "bg-accent-soft text-accent-ink",
  ON_HOLD: "bg-warning-soft text-warning-ink",
  COMPLETE: "bg-good-soft text-good-ink",
  SUBMITTED: "bg-accent-soft text-accent-ink",
  APPROVED: "bg-good-soft text-good-ink",
  REJECTED: "bg-critical-soft text-critical-ink",
  EXPORTED: "bg-violet-soft text-violet-ink",
  PAID: "bg-good-soft-2 text-good-ink",
  REIMBURSED: "bg-good-soft-2 text-good-ink",
  REQUESTED: "bg-warning-soft text-warning-ink",
  ORDERED: "bg-accent-soft text-accent-ink",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cx("inline-block rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", STATUS_STYLES[status] ?? "bg-surface-3")}>
      {status.replace(/_/g, " ").toLowerCase()}
    </span>
  );
}

/** Budget status: never color alone, always icon + label. */
export function AlertBadge({ alert }: { alert: BudgetAlert }) {
  const spec = {
    OK: { icon: "✓", label: "On budget", color: "var(--color-good)" },
    WARNING: { icon: "▲", label: "≥80% used", color: "var(--color-warning)" },
    OVER: { icon: "✕", label: "Over", color: "var(--color-critical)" },
  }[alert];
  return (
    <span className="inline-flex items-center gap-1 text-xs whitespace-nowrap text-ink-2">
      <span aria-hidden style={{ color: spec.color }} className="font-bold">
        {spec.icon}
      </span>
      {spec.label}
    </span>
  );
}

export const Money = ({ cents, showCents = false }: { cents: number; showCents?: boolean }) => (
  <span className="tabular">{formatCents(cents, { showCents })}</span>
);
export const Hours = ({ minutes }: { minutes: number }) => <span className="tabular">{formatMinutes(minutes)}</span>;

export function ErrorText({ error }: { error?: string | null }) {
  if (!error) return null;
  return <p className="rounded-md bg-critical-soft px-3 py-2 text-sm text-critical-ink">{error}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted">{children}</p>;
}

export function Loading() {
  return <p className="py-6 text-center text-sm text-faint">Loading…</p>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Inline bar: actual spend vs budget for one table row. Thin bar, rounded data end,
 * budget shown as a tick on a neutral track. Overruns extend past the tick.
 */
export function BudgetBar({ budget, actual, max }: { budget: number; actual: number; max: number }) {
  const scale = (v: number) => `${Math.min(100, (v / Math.max(1, max)) * 100)}%`;
  return (
    <div
      className="relative h-3 w-full min-w-24"
      role="img"
      aria-label={`Actual ${formatCents(actual)} of budget ${formatCents(budget)}`}
      title={`Actual ${formatCents(actual)} · Budget ${formatCents(budget)}${budget ? ` · ${Math.round((actual / budget) * 100)}%` : ""}`}
    >
      <div className="absolute inset-y-1 left-0 rounded-sm" style={{ width: scale(budget), background: "var(--color-track)" }} />
      <div className="absolute inset-y-0.5 left-0 rounded-r" style={{ width: scale(actual), background: "var(--color-series-1)" }} />
      {budget > 0 && <div className="absolute -inset-y-0.5 w-0.5 bg-ink-2" style={{ left: scale(budget) }} />}
    </div>
  );
}
