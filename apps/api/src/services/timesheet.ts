import { fromDbDate, type Organization, type PayPeriod } from "@timepeace/db";
import {
  DEFAULT_MIN_UNPAID_BREAK_MINUTES,
  LOCKED_TIMESHEET_STATUSES,
  NO_OVERTIME_RULES,
  computeOvertime,
  grossPayCents,
  minutesBetween,
  paidShiftMinutes,
  shiftInterval,
  type WorkInterval,
  localRangeToUtc,
  toLocalDate,
  type LocalDate,
  type TimesheetStatus,
} from "@timepeace/shared";
import { TRPCError } from "@trpc/server";
import type { Tx } from "../lib/db";
import { getOrCreatePayPeriod, overtimeRules } from "./org";

export function periodRange(org: Organization, period: PayPeriod) {
  return localRangeToUtc(fromDbDate(period.startDate), fromDbDate(period.endDate), org.timezone);
}

/** Pay rate in effect on each date, from effective-dated history. */
export async function rateLookup(tx: Tx, orgId: string, userId: string) {
  const profile = await tx.workerProfile.findUnique({
    where: { orgId_userId: { orgId, userId } },
    include: { payRates: { orderBy: { effectiveDate: "asc" } } },
  });
  const rates = (profile?.payRates ?? []).map((r) => ({ from: fromDbDate(r.effectiveDate), cents: r.hourlyRateCents }));
  return {
    profile,
    rateFor(date: LocalDate): number {
      let rate = rates[0]?.cents ?? 0;
      for (const r of rates) if (r.from <= date) rate = r.cents;
      return rate;
    },
  };
}

const entryMinutes = (e: { startedAt: Date; endedAt: Date | null; breakMinutes: number }, now?: Date) => {
  const end = e.endedAt ?? now;
  return end ? Math.max(0, minutesBetween(e.startedAt, end) - e.breakMinutes) : 0;
};

/**
 * Pay is computed from SHIFTS (clock in → clock out), never from task timers alone, so time
 * between tasks (travel, setup, cleanup, waiting on materials) is paid. Task entries only
 * show how much of the shift was allocated to jobs. `live` includes open shifts up to now.
 */
export async function computeTotals(tx: Tx, org: Organization, userId: string, period: PayPeriod, opts: { live?: boolean } = {}) {
  const range = periodRange(org, period);
  const now = opts.live ? new Date() : undefined;
  const rules = overtimeRules(org);
  const minUnpaidBreakMinutes = rules.minUnpaidBreakMinutes ?? DEFAULT_MIN_UNPAID_BREAK_MINUTES;
  const shifts = await tx.shift.findMany({
    where: { orgId: org.id, userId, clockInAt: range },
    orderBy: { clockInAt: "asc" },
    include: {
      breaks: { orderBy: { startedAt: "asc" } },
      project: { select: { name: true } },
      timeEntries: { orderBy: { startedAt: "asc" }, include: { task: { select: { title: true } }, project: { select: { name: true } } } },
    },
  });
  // Safety net: task time recorded outside any shift is still paid.
  const orphans = await tx.timeEntry.findMany({
    where: { orgId: org.id, userId, shiftId: null, startedAt: range },
    include: { task: { select: { title: true } }, project: { select: { name: true } } },
  });

  const { profile, rateFor } = await rateLookup(tx, org.id, userId);
  const isContractor = profile?.classification === "CONTRACTOR_1099";
  const intervals: WorkInterval[] = [
    ...shifts.map((s) => shiftInterval(s, { now, minUnpaidBreakMinutes })).filter((i): i is WorkInterval => i != null),
    ...orphans.filter((e) => e.endedAt).map((e) => ({ start: e.startedAt, end: e.endedAt!, breakMinutes: e.breakMinutes })),
  ];
  const ot = computeOvertime(intervals, isContractor ? NO_OVERTIME_RULES : rules, org.timezone);

  const shiftRows = shifts.map((s) => {
    const paidMinutes = paidShiftMinutes(s, { now, minUnpaidBreakMinutes });
    const allocatedMinutes = s.timeEntries.reduce((a, e) => a + entryMinutes(e, now), 0);
    return {
      id: s.id,
      clockInAt: s.clockInAt,
      clockOutAt: s.clockOutAt,
      projectName: s.project?.name ?? null,
      flag: s.flag,
      note: s.note,
      hasGeo: s.inLat != null,
      breaks: s.breaks.map((b) => ({ id: b.id, startedAt: b.startedAt, endedAt: b.endedAt })),
      paidMinutes,
      allocatedMinutes,
      /** Paid time not on any task (travel, setup, cleanup…). Still paid. */
      unallocatedMinutes: Math.max(0, paidMinutes - allocatedMinutes),
      entries: s.timeEntries.map((e) => ({
        id: e.id,
        startedAt: e.startedAt,
        endedAt: e.endedAt,
        breakMinutes: e.breakMinutes,
        minutes: entryMinutes(e, now),
        taskTitle: e.task?.title ?? null,
        projectName: e.project.name,
        note: e.note,
        source: e.source,
      })),
    };
  });

  return {
    shifts: shiftRows,
    orphanEntries: orphans,
    hasOpenShift: shifts.some((s) => !s.clockOutAt),
    hasRunningTask: shifts.some((s) => s.timeEntries.some((e) => !e.endedAt)) || orphans.some((e) => !e.endedAt),
    needsReview: shifts.some((s) => s.flag === "AUTO_CLOSED"),
    overtime: ot,
    allocatedMinutes: shiftRows.reduce((a, s) => a + s.allocatedMinutes, 0) + orphans.reduce((a, e) => a + entryMinutes(e, now), 0),
    grossCents: grossPayCents(ot.days, rateFor),
    isContractor,
  };
}

async function linkToTimesheet(tx: Tx, timesheetId: string, totals: Awaited<ReturnType<typeof computeTotals>>) {
  await tx.shift.updateMany({ where: { id: { in: totals.shifts.map((s) => s.id) } }, data: { timesheetId } });
  const entryIds = [...totals.shifts.flatMap((s) => s.entries.map((e) => e.id)), ...totals.orphanEntries.map((e) => e.id)];
  await tx.timeEntry.updateMany({ where: { id: { in: entryIds } }, data: { timesheetId } });
}

/** Throws if time on `instant` falls in a locked (approved/exported/paid) timesheet. */
export async function assertPeriodOpen(tx: Tx, org: Organization, userId: string, instant: Date) {
  const period = await getOrCreatePayPeriod(tx, org, toLocalDate(instant, org.timezone));
  const ts = await tx.timesheet.findUnique({ where: { userId_payPeriodId: { userId, payPeriodId: period.id } } });
  if (ts && LOCKED_TIMESHEET_STATUSES.includes(ts.status as TimesheetStatus)) {
    throw new TRPCError({ code: "CONFLICT", message: "That pay period's timesheet is already approved and locked" });
  }
  return { period, timesheet: ts };
}

export async function submitTimesheet(tx: Tx, org: Organization, userId: string, payPeriodId: string) {
  const period = await tx.payPeriod.findFirstOrThrow({ where: { id: payPeriodId, orgId: org.id } });
  const existing = await tx.timesheet.findUnique({ where: { userId_payPeriodId: { userId, payPeriodId } } });
  if (existing && !["DRAFT", "REJECTED"].includes(existing.status)) {
    throw new TRPCError({ code: "CONFLICT", message: `Timesheet is already ${existing.status.toLowerCase()}` });
  }
  const totals = await computeTotals(tx, org, userId, period);
  if (totals.hasOpenShift) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Clock out before submitting your timesheet" });
  }
  if (totals.shifts.length === 0 && totals.orphanEntries.length === 0) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No time recorded in this period" });
  }
  const ts = await tx.timesheet.upsert({
    where: { userId_payPeriodId: { userId, payPeriodId } },
    create: { orgId: org.id, userId, payPeriodId, status: "SUBMITTED", submittedAt: new Date() },
    update: { status: "SUBMITTED", submittedAt: new Date(), reviewNote: null },
  });
  await linkToTimesheet(tx, ts.id, totals);
  return ts;
}

/** Approve: freeze computed hours and gross. Reject: return to worker with a note. */
export async function reviewTimesheet(
  tx: Tx,
  org: Organization,
  reviewerId: string,
  timesheetId: string,
  decision: "APPROVE" | "REJECT",
  note: string | null | undefined,
) {
  const ts = await tx.timesheet.findFirst({ where: { id: timesheetId, orgId: org.id }, include: { payPeriod: true } });
  if (!ts) throw new TRPCError({ code: "NOT_FOUND" });
  if (ts.status !== "SUBMITTED") {
    throw new TRPCError({ code: "CONFLICT", message: `Only submitted timesheets can be reviewed (is ${ts.status})` });
  }
  if (decision === "REJECT") {
    if (!note) throw new TRPCError({ code: "BAD_REQUEST", message: "A note is required when rejecting" });
    return tx.timesheet.update({
      where: { id: ts.id },
      data: { status: "REJECTED", reviewedById: reviewerId, reviewedAt: new Date(), reviewNote: note },
    });
  }
  const totals = await computeTotals(tx, org, ts.userId, ts.payPeriod);
  if (totals.hasOpenShift) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Worker is still clocked in for a shift in this period" });
  }
  if (totals.needsReview) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "A shift was auto-closed (no clock-out). Confirm or correct its times before approving." });
  }
  await linkToTimesheet(tx, ts.id, totals);
  return tx.timesheet.update({
    where: { id: ts.id },
    data: {
      status: "APPROVED",
      reviewedById: reviewerId,
      reviewedAt: new Date(),
      reviewNote: note ?? null,
      regularMinutes: totals.overtime.regularMinutes,
      overtimeMinutes: totals.overtime.overtimeMinutes,
      doubleTimeMinutes: totals.overtime.doubleTimeMinutes,
      grossCents: totals.grossCents,
      allocatedMinutes: totals.allocatedMinutes,
    },
  });
}
