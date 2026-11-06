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
        variant === "primary" && "bg-brand-600 text-white hover:bg-brand-700",
        variant === "secondary" && "border border-stone-300 bg-white text-stone-800 hover:bg-stone-50",
        variant === "danger" && "border border-red-300 bg-white text-red-700 hover:bg-red-50",
        variant === "ghost" && "text-stone-600 hover:bg-stone-100",
        className,
      )}
    />
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-lg border border-stone-200 bg-white", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-stone-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-stone-800">{title}</h2>
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
      {label && <span className="text-stone-600">{label}</span>}
      <input {...props} className="rounded-md border border-stone-300 px-2.5 py-1.5 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
    </label>
  );
}

export function Select({ label, className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <label className={cx("flex flex-col gap-1 text-sm", className)}>
      {label && <span className="text-stone-600">{label}</span>}
      <select {...props} className="rounded-md border border-stone-300 bg-white px-2 py-1.5 outline-none focus:border-brand-500">
        {children}
      </select>
    </label>
  );
}

const STATUS_STYLES: Record<string, string> = {
  TODO: "bg-stone-100 text-stone-700",
  IN_PROGRESS: "bg-brand-50 text-brand-700",
  NEEDS_MATERIALS: "bg-amber-50 text-amber-800",
  BLOCKED: "bg-red-50 text-red-700",
  DONE: "bg-green-50 text-green-800",
  VERIFIED: "bg-green-100 text-green-900",
  PLANNING: "bg-stone-100 text-stone-700",
  ACTIVE: "bg-brand-50 text-brand-700",
  ON_HOLD: "bg-amber-50 text-amber-800",
  COMPLETE: "bg-green-50 text-green-800",
  SUBMITTED: "bg-brand-50 text-brand-700",
  APPROVED: "bg-green-50 text-green-800",
  REJECTED: "bg-red-50 text-red-700",
  EXPORTED: "bg-violet-50 text-violet-800",
  PAID: "bg-green-100 text-green-900",
  REIMBURSED: "bg-green-100 text-green-900",
  REQUESTED: "bg-amber-50 text-amber-800",
  ORDERED: "bg-brand-50 text-brand-700",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cx("inline-block rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", STATUS_STYLES[status] ?? "bg-stone-100")}>
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
    <span className="inline-flex items-center gap-1 text-xs whitespace-nowrap text-stone-700">
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
  return <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-stone-500">{children}</p>;
}

export function Loading() {
  return <p className="py-6 text-center text-sm text-stone-400">Loading…</p>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold text-stone-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-stone-500">{subtitle}</p>}
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
      <div className="absolute inset-y-1 left-0 rounded-sm" style={{ width: scale(budget), background: "var(--track)" }} />
      <div className="absolute inset-y-0.5 left-0 rounded-r" style={{ width: scale(actual), background: "var(--series-1)" }} />
      {budget > 0 && <div className="absolute -inset-y-0.5 w-0.5 bg-stone-700" style={{ left: scale(budget) }} />}
    </div>
  );
}
