import { z } from "zod";
import { ROLES, WORKER_CLASSIFICATIONS, type Role } from "./enums";

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Owner",
  MANAGER: "Manager",
  WORKER: "Field worker",
  HR: "HR / payroll",
  ACCOUNTANT: "Accountant",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  OWNER: "Everything, including roles, pay and tax",
  MANAGER: "Projects, scheduling, approvals and job finance",
  WORKER: "Mobile app: clock in, tasks, expenses, own timesheet",
  HR: "Approved hours, pay rates and payroll exports",
  ACCOUNTANT: "Finance and tax center",
};

/** Days an invite link stays valid. */
export const INVITE_TTL_DAYS = 7;
export const MIN_PASSWORD_LENGTH = 10;

/**
 * Who may invite, deactivate or reactivate someone with `target` role. Owners manage everyone;
 * managers and HR manage field workers only. Nobody can hand out a role above their own.
 */
export function canManageRole(actor: Role, target: Role): boolean {
  if (actor === "OWNER") return true;
  if (actor === "MANAGER" || actor === "HR") return target === "WORKER";
  return false;
}

/** Roles that may open the Team page at all. */
export const TEAM_ROLES: Role[] = ["OWNER", "MANAGER", "HR"];
/** Roles that see and set pay rates (matches org.setPayRate). */
export const PAY_ROLES: Role[] = ["OWNER", "HR"];

export function invitableRoles(actor: Role): Role[] {
  return ROLES.filter((r) => canManageRole(actor, r));
}

export type InviteStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";

export function inviteStatus(i: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }, now = new Date()): InviteStatus {
  if (i.acceptedAt) return "ACCEPTED";
  if (i.revokedAt) return "REVOKED";
  if (i.expiresAt <= now) return "EXPIRED";
  return "PENDING";
}

const phone = z
  .string()
  .trim()
  .transform((s) => s.replace(/[^\d+]/g, ""))
  .refine((s) => /^\+?\d{10,15}$/.test(s), "Enter a phone number with area code");

export const createInviteInput = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email()),
    name: z.string().trim().min(1).max(120),
    phone: phone.nullish(),
    role: z.enum(ROLES),
    classification: z.enum(WORKER_CLASSIFICATIONS).nullish(),
    hourlyRateCents: z.number().int().positive().max(100_000).nullish(),
  })
  .refine((v) => v.role !== "WORKER" || v.classification, { message: "Choose W-2 or 1099 for field workers", path: ["classification"] });

export const newPassword = z.string().min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`).max(200);

export const acceptInviteInput = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(1).max(200),
  /** Only used when creating a new account. */
  name: z.string().trim().min(1).max(120).optional(),
});

/** Inviter-facing message for texting or emailing the link. */
export function inviteMessage(orgName: string, inviterName: string, url: string): string {
  return `${inviterName} invited you to ${orgName} on Timepeace. Set up your account (link expires in ${INVITE_TTL_DAYS} days): ${url}`;
}
