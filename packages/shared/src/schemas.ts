import { z } from "zod";
import {
  CONTRACT_TYPES,
  COST_CATEGORIES,
  PAID_BY,
  PROJECT_STATUSES,
  TASK_STATUSES,
  WORKER_CLASSIFICATIONS,
} from "./enums";

const isoInstant = z.iso.datetime({ offset: true });
const localDate = z.iso.date();
const cents = z.number().int();
const id = z.string().min(1);

export const loginInput = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  password: z.string().min(1),
});

export const createProjectInput = z.object({
  name: z.string().min(1).max(200),
  clientId: id.nullish(),
  clientName: z.string().max(200).nullish(),
  address: z.string().max(500).nullish(),
  projectType: z.string().max(100).nullish(),
  contractType: z.enum(CONTRACT_TYPES).default("FIXED"),
  contractValueCents: cents.nonnegative().default(0),
  markupBps: z.number().int().min(0).max(10_000).nullish(),
  startDate: localDate.nullish(),
  targetEndDate: localDate.nullish(),
  templateId: id.nullish(),
});
export type CreateProjectInput = z.infer<typeof createProjectInput>;

export const updateProjectInput = createProjectInput
  .omit({ templateId: true })
  .partial()
  .extend({ id, status: z.enum(PROJECT_STATUSES).optional() });

export const createPhaseInput = z.object({ projectId: id, name: z.string().min(1).max(200) });

export const createTaskInput = z.object({
  projectId: id,
  phaseId: id.nullish(),
  costCodeId: id.nullish(),
  title: z.string().min(1).max(300),
  description: z.string().max(5000).nullish(),
  estimatedMinutes: z.number().int().nonnegative().nullish(),
  estimatedMaterialCents: cents.nonnegative().nullish(),
});

export const updateTaskInput = createTaskInput
  .omit({ projectId: true })
  .partial()
  .extend({ id, status: z.enum(TASK_STATUSES).optional() });

export const assignTaskInput = z.object({
  taskId: id,
  userId: id,
  scheduledDate: localDate.nullish(),
});

export const upsertBudgetLineInput = z.object({
  projectId: id,
  costCodeId: id,
  category: z.enum(COST_CATEGORIES),
  amountCents: cents.nonnegative(),
});

export const workerProfileInput = z.object({
  userId: id,
  classification: z.enum(WORKER_CLASSIFICATIONS),
  hourlyRateCents: cents.positive(),
  burdenBps: z.number().int().min(0).max(20_000),
  effectiveDate: localDate,
});

export const reviewTimesheetInput = z.object({
  timesheetId: id,
  decision: z.enum(["APPROVE", "REJECT"]),
  note: z.string().max(2000).nullish(),
});

export const editShiftInput = z.object({
  id,
  clockInAt: isoInstant,
  clockOutAt: isoInstant,
  reason: z.string().min(3).max(500),
});

export const editTimeEntryInput = z.object({
  id,
  startedAt: isoInstant,
  endedAt: isoInstant,
  breakMinutes: z.number().int().min(0).max(24 * 60).default(0),
  reason: z.string().min(3).max(500),
});

export const reviewExpenseInput = z.object({
  expenseId: id,
  decision: z.enum(["APPROVE", "REJECT"]),
  note: z.string().max(2000).nullish(),
});

/* ---------- Offline outbox operations (mobile → API) ---------- */

const geo = z
  .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracyM: z.number().nonnegative().optional() })
  .nullish();

export const outboxOp = z.discriminatedUnion("type", [
  z.object({
    opId: z.uuid(),
    type: z.literal("shift.clockIn"),
    at: isoInstant,
    payload: z.object({ shiftId: z.uuid(), projectId: id.nullish(), geo }),
  }),
  z.object({
    opId: z.uuid(),
    type: z.literal("shift.clockOut"),
    at: isoInstant,
    payload: z.object({ shiftId: z.uuid(), geo, note: z.string().max(2000).nullish() }),
  }),
  z.object({
    opId: z.uuid(),
    type: z.literal("shift.breakStart"),
    at: isoInstant,
    payload: z.object({ shiftId: z.uuid(), breakId: z.uuid() }),
  }),
  z.object({
    opId: z.uuid(),
    type: z.literal("shift.breakEnd"),
    at: isoInstant,
    payload: z.object({ shiftId: z.uuid(), breakId: z.uuid() }),
  }),
  z.object({
    opId: z.uuid(),
    type: z.literal("time.start"),
    at: isoInstant,
    payload: z.object({ entryId: z.uuid(), taskId: id, projectId: id, geo }),
  }),
  z.object({
    opId: z.uuid(),
    type: z.literal("time.stop"),
    at: isoInstant,
    payload: z.object({ entryId: z.uuid(), geo, note: z.string().max(2000).nullish() }),
  }),
  z.object({
    opId: z.uuid(),
    type: z.literal("task.status"),
    at: isoInstant,
    payload: z.object({
      taskId: id,
      status: z.enum(["IN_PROGRESS", "NEEDS_MATERIALS", "BLOCKED", "DONE"]),
      note: z.string().max(2000).nullish(),
    }),
  }),
  z.object({
    opId: z.uuid(),
    type: z.literal("material.request"),
    at: isoInstant,
    payload: z.object({
      requestId: z.uuid(),
      taskId: id,
      description: z.string().min(1).max(2000),
      quantity: z.string().max(100).nullish(),
      neededBy: localDate.nullish(),
    }),
  }),
  z.object({
    opId: z.uuid(),
    type: z.literal("expense.create"),
    at: isoInstant,
    payload: z.object({
      expenseId: z.uuid(),
      projectId: id,
      taskId: id.nullish(),
      vendorName: z.string().min(1).max(200),
      amountCents: cents.positive(),
      salesTaxCents: cents.nonnegative().default(0),
      category: z.enum(COST_CATEGORIES).default("MATERIAL"),
      paidBy: z.enum(PAID_BY),
      note: z.string().max(2000).nullish(),
      receiptFileId: id.nullish(),
      spentOn: localDate,
    }),
  }),
]);
export type OutboxOp = z.infer<typeof outboxOp>;
export type OutboxOpType = OutboxOp["type"];

export const syncPushInput = z.object({ ops: z.array(outboxOp).max(200) });

export type SyncOpResult = {
  opId: string;
  status: "applied" | "duplicate" | "rejected";
  error?: string;
};
