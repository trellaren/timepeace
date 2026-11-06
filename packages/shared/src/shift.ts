import { minutesBetween } from "./time";
import type { WorkInterval } from "./overtime";

/**
 * Shifts (clock in → clock out) are what workers are PAID for. Task timers only allocate
 * time inside a shift for job costing; time on no task (travel between sites, setup, cleanup,
 * waiting on materials) is still paid.
 *
 * Breaks: only a recorded meal break of at least `minUnpaidBreakMinutes` (default 20) is
 * deducted. Under the FLSA, short rest breaks (5–20 min) count as hours worked, so a
 * shorter "break" stays paid. Pay is computed to the exact minute; there is no rounding.
 */
export const DEFAULT_MIN_UNPAID_BREAK_MINUTES = 20;

export interface BreakInput {
  startedAt: Date;
  endedAt: Date | null;
}

export interface ShiftInput {
  clockInAt: Date;
  clockOutAt: Date | null;
  breaks: BreakInput[];
}

/** Unpaid minutes in a shift: closed breaks ≥ the minimum, clipped to the shift. */
export function unpaidBreakMinutes(shift: ShiftInput, end: Date, minUnpaid = DEFAULT_MIN_UNPAID_BREAK_MINUTES): number {
  let total = 0;
  for (const b of shift.breaks) {
    if (!b.endedAt) continue; // an open break isn't deducted until it ends
    const s = Math.max(b.startedAt.getTime(), shift.clockInAt.getTime());
    const e = Math.min(b.endedAt.getTime(), end.getTime());
    const mins = Math.max(0, Math.round((e - s) / 60_000));
    if (mins >= minUnpaid) total += mins;
  }
  return total;
}

/** A shift as a payable interval. Open shifts use `now` (live view), or are skipped when `now` isn't given. */
export function shiftInterval(shift: ShiftInput, opts: { now?: Date; minUnpaidBreakMinutes?: number } = {}): WorkInterval | null {
  const end = shift.clockOutAt ?? opts.now;
  if (!end) return null;
  return { start: shift.clockInAt, end, breakMinutes: unpaidBreakMinutes(shift, end, opts.minUnpaidBreakMinutes) };
}

export function paidShiftMinutes(shift: ShiftInput, opts: { now?: Date; minUnpaidBreakMinutes?: number } = {}): number {
  const i = shiftInterval(shift, opts);
  return i ? Math.max(0, minutesBetween(i.start, i.end) - (i.breakMinutes ?? 0)) : 0;
}

/* ───────────── Field state machine (shared by mobile, mirrored by the API) ───────────── */

export interface FieldState {
  shift: { shiftId: string; clockedInAt: string; projectId: string | null; onBreak: { breakId: string; startedAt: string } | null } | null;
  task: { entryId: string; taskId: string; projectId: string; startedAt: string } | null;
}

export const initialFieldState: FieldState = { shift: null, task: null };

export type FieldEvent =
  | { type: "CLOCK_IN"; at: string; projectId?: string | null }
  | { type: "CLOCK_OUT"; at: string }
  | { type: "BREAK_START"; at: string }
  | { type: "BREAK_END"; at: string }
  | { type: "TASK_START"; at: string; taskId: string; projectId: string }
  | { type: "TASK_STOP"; at: string };

/** Outbox ops (minus opId and geo) that a transition produces, in the order they must be sent. */
export type FieldEffect =
  | { type: "shift.clockIn"; at: string; payload: { shiftId: string; projectId: string | null } }
  | { type: "shift.clockOut"; at: string; payload: { shiftId: string } }
  | { type: "shift.breakStart"; at: string; payload: { shiftId: string; breakId: string } }
  | { type: "shift.breakEnd"; at: string; payload: { shiftId: string; breakId: string } }
  | { type: "time.start"; at: string; payload: { entryId: string; taskId: string; projectId: string } }
  | { type: "time.stop"; at: string; payload: { entryId: string } };

export class FieldError extends Error {
  constructor(
    public readonly code: "NOT_CLOCKED_IN" | "ALREADY_CLOCKED_IN" | "NOT_ON_TASK" | "ALREADY_ON_TASK" | "NOT_ON_BREAK" | "ALREADY_ON_BREAK" | "TIME_TRAVEL",
    message: string,
  ) {
    super(message);
    this.name = "FieldError";
  }
}

/**
 * - Starting a task when not clocked in clocks you in first (you can't work unpaid).
 * - Starting a task during a meal break ends the break.
 * - Starting a break or clocking out stops the running task.
 * - Switching tasks stops the previous one at the same instant.
 */
export function fieldReducer(state: FieldState, event: FieldEvent, newId: () => string): { state: FieldState; effects: FieldEffect[] } {
  const at = event.at;
  const effects: FieldEffect[] = [];
  let { shift, task } = state;
  if (shift && Date.parse(at) < Date.parse(shift.clockedInAt)) {
    throw new FieldError("TIME_TRAVEL", "That time is before you clocked in");
  }
  const stopTask = () => {
    if (task) {
      effects.push({ type: "time.stop", at, payload: { entryId: task.entryId } });
      task = null;
    }
  };
  const endBreak = () => {
    if (shift?.onBreak) {
      effects.push({ type: "shift.breakEnd", at, payload: { shiftId: shift.shiftId, breakId: shift.onBreak.breakId } });
      shift = { ...shift, onBreak: null };
    }
  };
  const clockIn = (projectId: string | null) => {
    const shiftId = newId();
    shift = { shiftId, clockedInAt: at, projectId, onBreak: null };
    effects.push({ type: "shift.clockIn", at, payload: { shiftId, projectId } });
  };

  switch (event.type) {
    case "CLOCK_IN":
      if (shift) throw new FieldError("ALREADY_CLOCKED_IN", "You're already clocked in");
      clockIn(event.projectId ?? null);
      break;
    case "CLOCK_OUT":
      if (!shift) throw new FieldError("NOT_CLOCKED_IN", "You're not clocked in");
      stopTask();
      endBreak();
      effects.push({ type: "shift.clockOut", at, payload: { shiftId: shift.shiftId } });
      shift = null;
      break;
    case "BREAK_START":
      if (!shift) throw new FieldError("NOT_CLOCKED_IN", "Clock in first");
      if (shift.onBreak) throw new FieldError("ALREADY_ON_BREAK", "You're already on a break");
      stopTask();
      shift = { ...shift, onBreak: { breakId: newId(), startedAt: at } };
      effects.push({ type: "shift.breakStart", at, payload: { shiftId: shift.shiftId, breakId: shift.onBreak!.breakId } });
      break;
    case "BREAK_END":
      if (!shift?.onBreak) throw new FieldError("NOT_ON_BREAK", "You're not on a break");
      endBreak();
      break;
    case "TASK_START":
      if (task?.taskId === event.taskId) throw new FieldError("ALREADY_ON_TASK", "You're already working on this task");
      if (!shift) clockIn(event.projectId);
      endBreak();
      stopTask();
      task = { entryId: newId(), taskId: event.taskId, projectId: event.projectId, startedAt: at };
      effects.push({ type: "time.start", at, payload: { entryId: task.entryId, taskId: event.taskId, projectId: event.projectId } });
      break;
    case "TASK_STOP":
      if (!task) throw new FieldError("NOT_ON_TASK", "No task timer is running");
      stopTask();
      break;
  }
  return { state: { shift, task }, effects };
}
