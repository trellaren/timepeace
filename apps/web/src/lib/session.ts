import type { Role } from "@timepeace/shared";

export interface Session {
  token: string;
  user: { id: string; name: string; email: string };
  role: Role;
  org: { id: string; name: string; timezone: string };
}

const KEY = "timepeace.session";

export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return getSession()?.token ?? null;
}

export function saveSession(s: Session) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function clearSession() {
  localStorage.removeItem(KEY);
}

export const can = {
  manage: (r?: Role) => r === "OWNER" || r === "MANAGER",
  finance: (r?: Role) => r === "OWNER" || r === "MANAGER" || r === "ACCOUNTANT",
  payroll: (r?: Role) => r === "OWNER" || r === "HR",
  tax: (r?: Role) => r === "OWNER" || r === "ACCOUNTANT",
  team: (r?: Role) => r === "OWNER" || r === "MANAGER" || r === "HR",
  /** Task discussions: the crew and the office, not HR or accountants. */
  discuss: (r?: Role) => r === "OWNER" || r === "MANAGER" || r === "WORKER",
};
