"use client";

import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "@timepeace/api-client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { can, clearSession, getSession, type Session } from "@/lib/session";
import { cx } from "./ui";

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const trpc = useTRPC();
  const logout = useMutation(trpc.auth.logout.mutationOptions());

  useEffect(() => {
    const s = getSession();
    setSession(s);
    if (!s) router.replace("/login");
  }, [router]);

  if (!session) return null;
  const role = session.role;
  const links = [
    { href: "/", label: "Dashboard", show: true },
    { href: "/projects", label: "Projects", show: can.manage(role) || can.finance(role) },
    { href: "/approvals", label: "Approvals", show: can.manage(role) },
    { href: "/payroll", label: "Payroll", show: can.payroll(role) },
    { href: "/finance", label: "Finance", show: can.finance(role) },
    { href: "/tax", label: "Tax", show: can.tax(role) },
    { href: "/team", label: "Team", show: can.team(role) },
  ].filter((l) => l.show);

  return (
    <div className="min-h-screen">
      <nav className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3">
          <Link href="/" className="text-lg font-bold tracking-tight text-brand-700">
            timepeace
          </Link>
          <div className="flex gap-1">
            {links.map((l) => {
              const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
              return (
                <Link key={l.href} href={l.href} className={cx("rounded-md px-3 py-1.5 text-sm", active ? "bg-brand-50 font-medium text-brand-700" : "text-stone-600 hover:bg-stone-100")}>
                  {l.label}
                </Link>
              );
            })}
          </div>
          <div className="ml-auto flex items-center gap-3 text-sm text-stone-600">
            <span>
              {session.user.name} · <span className="text-stone-400">{session.org.name} ({role.toLowerCase()})</span>
            </span>
            <button
              className="text-stone-500 hover:text-stone-800"
              onClick={async () => {
                await logout.mutateAsync().catch(() => {});
                clearSession();
                router.replace("/login");
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </nav>
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}

export function useSession() {
  const [s, setS] = useState<Session | null>(null);
  useEffect(() => setS(getSession()), []);
  return s;
}
