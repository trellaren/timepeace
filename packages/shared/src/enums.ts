/**
 * Domain enums shared by API, web and mobile. These mirror the Prisma enums in
 * packages/db/prisma/schema.prisma; keep the two in sync.
 */
export const ROLES = ["OWNER", "MANAGER", "WORKER", "HR", "ACCOUNTANT"] as const;
export type Role = (typeof ROLES)[number];

export const TASK_STATUSES = [
  "TODO",
  "IN_PROGRESS",
  "NEEDS_MATERIALS",
  "BLOCKED",
  "DONE",
  "VERIFIED",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const COMPLETED_TASK_STATUSES: readonly TaskStatus[] = ["DONE", "VERIFIED"];

export const PROJECT_STATUSES = ["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETE", "CANCELLED"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const CONTRACT_TYPES = ["FIXED", "COST_PLUS", "T_AND_M"] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

export const COST_CATEGORIES = ["LABOR", "MATERIAL", "SUB", "EQUIPMENT", "OTHER"] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];

export const WORKER_CLASSIFICATIONS = ["W2", "CONTRACTOR_1099"] as const;
export type WorkerClassification = (typeof WORKER_CLASSIFICATIONS)[number];

export const TIMESHEET_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "EXPORTED",
  "PAID",
] as const;
export type TimesheetStatus = (typeof TIMESHEET_STATUSES)[number];
/** Once a timesheet reaches one of these states its time entries are locked. */
export const LOCKED_TIMESHEET_STATUSES: readonly TimesheetStatus[] = ["APPROVED", "EXPORTED", "PAID"];

export const EXPENSE_STATUSES = ["SUBMITTED", "APPROVED", "REJECTED", "REIMBURSED"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export const PAID_BY = ["COMPANY", "PERSONAL"] as const;
export type PaidBy = (typeof PAID_BY)[number];

export const PAY_PERIOD_TYPES = ["WEEKLY", "BIWEEKLY", "SEMIMONTHLY"] as const;
export type PayPeriodType = (typeof PAY_PERIOD_TYPES)[number];

export const ENTITY_TYPES = ["SOLE_PROP", "LLC_SINGLE", "PARTNERSHIP", "S_CORP", "C_CORP"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const MATERIAL_REQUEST_STATUSES = ["REQUESTED", "ORDERED", "DELIVERED", "CANCELLED"] as const;
export type MaterialRequestStatus = (typeof MATERIAL_REQUEST_STATUSES)[number];
