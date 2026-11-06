import { describe, expect, it } from "vitest";
import { CALIFORNIA_RULES, FLSA_RULES, computeOvertime, type WorkInterval } from "../overtime";

const TZ = "America/Los_Angeles";
/** A shift on a local date in PDT (UTC-7 for the 2026-06 dates used here). */
function shift(date: string, startHour: number, hours: number, breakMinutes = 0): WorkInterval {
  const start = new Date(`${date}T${String(startHour).padStart(2, "0")}:00:00-07:00`);
  return { start, end: new Date(start.getTime() + hours * 3_600_000), breakMinutes };
}
// 2026-06-07 is a Sunday.
const WEEK = ["2026-06-07", "2026-06-08", "2026-06-09", "2026-06-10", "2026-06-11", "2026-06-12", "2026-06-13"];

describe("computeOvertime – FLSA", () => {
  it("40 hours is all regular", () => {
    const r = computeOvertime(WEEK.slice(1, 6).map((d) => shift(d, 7, 8)), FLSA_RULES, TZ);
    expect(r).toMatchObject({ totalMinutes: 2400, regularMinutes: 2400, overtimeMinutes: 0, doubleTimeMinutes: 0 });
  });

  it("hours over 40 in a week are OT; long days are not OT by themselves", () => {
    const r = computeOvertime(WEEK.slice(1, 6).map((d) => shift(d, 6, 10)), FLSA_RULES, TZ);
    expect(r.regularMinutes).toBe(2400);
    expect(r.overtimeMinutes).toBe(600);
    expect(r.days[4]).toMatchObject({ regularMinutes: 0, overtimeMinutes: 600 });
  });

  it("deducts breaks", () => {
    const r = computeOvertime([shift(WEEK[1]!, 7, 9, 30)], FLSA_RULES, TZ);
    expect(r.totalMinutes).toBe(510);
  });

  it("computes each workweek separately in a biweekly period", () => {
    const wk2 = WEEK.map((d) => d.replace(/-(\d\d)$/, (_, dd) => `-${String(Number(dd) + 7).padStart(2, "0")}`));
    const intervals = [...WEEK.slice(1, 6), ...wk2.slice(1, 6)].map((d) => shift(d, 6, 9));
    const r = computeOvertime(intervals, FLSA_RULES, TZ);
    expect(r.overtimeMinutes).toBe(2 * 5 * 60);
  });

  it("attributes a shift crossing midnight to its start day", () => {
    const r = computeOvertime([shift(WEEK[1]!, 20, 6)], FLSA_RULES, TZ);
    expect(r.days).toHaveLength(1);
    expect(r.days[0]!.date).toBe(WEEK[1]);
  });
});

describe("computeOvertime – California", () => {
  it("daily OT after 8h and DT after 12h", () => {
    const r = computeOvertime([shift(WEEK[1]!, 5, 13)], CALIFORNIA_RULES, TZ);
    expect(r).toMatchObject({ regularMinutes: 480, overtimeMinutes: 240, doubleTimeMinutes: 60 });
  });

  it("daily OT does not pyramid into weekly OT", () => {
    // 5 × 10h = 50h; daily OT = 10h, regular = 40h, so no extra weekly OT.
    const r = computeOvertime(WEEK.slice(1, 6).map((d) => shift(d, 6, 10)), CALIFORNIA_RULES, TZ);
    expect(r).toMatchObject({ regularMinutes: 2400, overtimeMinutes: 600, doubleTimeMinutes: 0 });
  });

  it("weekly OT kicks in on a 6th 8-hour day", () => {
    const r = computeOvertime(WEEK.slice(1, 7).map((d) => shift(d, 7, 8)), CALIFORNIA_RULES, TZ);
    expect(r).toMatchObject({ regularMinutes: 2400, overtimeMinutes: 480 });
  });

  it("seventh consecutive day: first 8h OT, rest DT", () => {
    const r = computeOvertime(WEEK.map((d) => shift(d, 7, 6)).concat([shift(WEEK[6]!, 14, 4)]), CALIFORNIA_RULES, TZ);
    const seventh = r.days[6]!;
    expect(seventh).toMatchObject({ workedMinutes: 600, regularMinutes: 0, overtimeMinutes: 480, doubleTimeMinutes: 120 });
    // first six days: 36h, all regular
    expect(r.regularMinutes).toBe(36 * 60);
  });
});

import { grossPayCents } from "../overtime";
describe("grossPayCents", () => {
  it("pays OT at 1.5x and DT at 2x", () => {
    const r = computeOvertime([shift(WEEK[1]!, 5, 13)], CALIFORNIA_RULES, TZ);
    // 8h×$30 + 4h×$45 + 1h×$60 = 240 + 180 + 60
    expect(grossPayCents(r.days, () => 3000)).toBe(48000);
  });
});
