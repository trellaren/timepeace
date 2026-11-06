import { describe, expect, it } from "vitest";
import { FieldError, fieldReducer, initialFieldState, paidShiftMinutes, unpaidBreakMinutes, type FieldState } from "../shift";

const t = (hhmm: string) => `2026-06-08T${hhmm}:00.000Z`;
const d = (hhmm: string) => new Date(t(hhmm));
let n = 0;
const id = () => `id${++n}`;

describe("paid shift time", () => {
  it("pays the whole shift, not just task time, minus a real meal break", () => {
    const shift = { clockInAt: d("13:00"), clockOutAt: d("22:00"), breaks: [{ startedAt: d("17:00"), endedAt: d("17:30") }] };
    expect(paidShiftMinutes(shift)).toBe(9 * 60 - 30);
  });
  it("keeps short breaks paid (FLSA rest breaks)", () => {
    const shift = { clockInAt: d("13:00"), clockOutAt: d("17:00"), breaks: [{ startedAt: d("15:00"), endedAt: d("15:15") }] };
    expect(unpaidBreakMinutes(shift, shift.clockOutAt)).toBe(0);
    expect(paidShiftMinutes(shift)).toBe(240);
  });
  it("doesn't deduct an open break and clips breaks to the shift", () => {
    const open = { clockInAt: d("13:00"), clockOutAt: d("17:00"), breaks: [{ startedAt: d("16:30"), endedAt: null }] };
    expect(paidShiftMinutes(open)).toBe(240);
    const overhang = { clockInAt: d("13:00"), clockOutAt: d("17:00"), breaks: [{ startedAt: d("16:30"), endedAt: d("17:30") }] };
    expect(paidShiftMinutes(overhang)).toBe(210);
  });
  it("live view of an open shift uses now", () => {
    expect(paidShiftMinutes({ clockInAt: d("13:00"), clockOutAt: null, breaks: [] }, { now: d("14:30") })).toBe(90);
    expect(paidShiftMinutes({ clockInAt: d("13:00"), clockOutAt: null, breaks: [] })).toBe(0);
  });
});

describe("fieldReducer", () => {
  const run = (events: Parameters<typeof fieldReducer>[1][]) => {
    let state: FieldState = initialFieldState;
    const all: string[] = [];
    for (const e of events) {
      const r = fieldReducer(state, e, id);
      state = r.state;
      all.push(...r.effects.map((x) => x.type));
    }
    return { state, effects: all };
  };

  it("starting a task when off the clock clocks in first", () => {
    const r = run([{ type: "TASK_START", at: t("13:00"), taskId: "a", projectId: "p" }]);
    expect(r.effects).toEqual(["shift.clockIn", "time.start"]);
    expect(r.state.shift?.projectId).toBe("p");
  });

  it("switching tasks stops the previous one; clocking out stops the task and ends the shift", () => {
    const r = run([
      { type: "CLOCK_IN", at: t("12:45") },
      { type: "TASK_START", at: t("13:00"), taskId: "a", projectId: "p" },
      { type: "TASK_START", at: t("14:00"), taskId: "b", projectId: "p" },
      { type: "CLOCK_OUT", at: t("21:00") },
    ]);
    expect(r.effects).toEqual(["shift.clockIn", "time.start", "time.stop", "time.start", "time.stop", "shift.clockOut"]);
    expect(r.state).toEqual({ shift: null, task: null });
  });

  it("a break stops the task; resuming a task ends the break", () => {
    const r = run([
      { type: "TASK_START", at: t("13:00"), taskId: "a", projectId: "p" },
      { type: "BREAK_START", at: t("17:00") },
      { type: "TASK_START", at: t("17:30"), taskId: "a", projectId: "p" },
    ]);
    expect(r.effects).toEqual(["shift.clockIn", "time.start", "time.stop", "shift.breakStart", "shift.breakEnd", "time.start"]);
    expect(r.state.shift?.onBreak).toBeNull();
  });

  it("stopping a task keeps you on the clock (time between tasks is paid)", () => {
    const r = run([
      { type: "TASK_START", at: t("13:00"), taskId: "a", projectId: "p" },
      { type: "TASK_STOP", at: t("14:00") },
    ]);
    expect(r.state.shift).not.toBeNull();
    expect(r.state.task).toBeNull();
  });

  it("rejects invalid transitions", () => {
    expect(() => run([{ type: "CLOCK_OUT", at: t("13:00") }])).toThrow(FieldError);
    expect(() => run([{ type: "CLOCK_IN", at: t("13:00") }, { type: "CLOCK_IN", at: t("13:05") }])).toThrow(/already clocked in/);
    expect(() => run([{ type: "CLOCK_IN", at: t("13:00") }, { type: "BREAK_END", at: t("13:05") }])).toThrow(/not on a break/);
    expect(() => run([{ type: "CLOCK_IN", at: t("13:00") }, { type: "CLOCK_OUT", at: t("12:00") }])).toThrow(/before you clocked in/);
  });
});
