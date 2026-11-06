import { describe, expect, it } from "vitest";
import { dollarsToCents, formatCents } from "../money";
import { payPeriodFor } from "../payPeriod";
import { dayOfWeek, startOfWeek, toLocalDate } from "../time";
import { toCsv } from "../csv";
import { outboxOp } from "../schemas";

describe("money", () => {
  it("parses dollars exactly", () => {
    expect(dollarsToCents("$1,234.5")).toBe(123450);
    expect(dollarsToCents("0.07")).toBe(7);
    expect(dollarsToCents(19.99)).toBe(1999);
    expect(() => dollarsToCents("1.234")).toThrow();
  });
  it("formats", () => expect(formatCents(123450)).toBe("$1,234.50"));
});

describe("time", () => {
  it("local date respects zone", () => {
    const i = new Date("2026-06-09T05:30:00Z");
    expect(toLocalDate(i, "America/Denver")).toBe("2026-06-08");
    expect(toLocalDate(i, "UTC")).toBe("2026-06-09");
  });
  it("weekdays", () => {
    expect(dayOfWeek("2026-06-07")).toBe(0);
    expect(startOfWeek("2026-06-10", 1)).toBe("2026-06-08");
  });
});

describe("payPeriodFor", () => {
  it("weekly", () => expect(payPeriodFor("2026-06-10", { type: "WEEKLY", anchorDate: "2026-01-04", weekStartsOn: 0 })).toEqual({ start: "2026-06-07", end: "2026-06-13" }));
  it("biweekly from anchor, including dates before it", () => {
    const cfg = { type: "BIWEEKLY" as const, anchorDate: "2026-01-04", weekStartsOn: 0 };
    expect(payPeriodFor("2026-01-17", cfg)).toEqual({ start: "2026-01-04", end: "2026-01-17" });
    expect(payPeriodFor("2026-01-18", cfg)).toEqual({ start: "2026-01-18", end: "2026-01-31" });
    expect(payPeriodFor("2026-01-03", cfg)).toEqual({ start: "2025-12-21", end: "2026-01-03" });
  });
  it("semimonthly handles month ends", () => {
    const cfg = { type: "SEMIMONTHLY" as const, anchorDate: "2026-01-01", weekStartsOn: 0 };
    expect(payPeriodFor("2026-02-20", cfg)).toEqual({ start: "2026-02-16", end: "2026-02-28" });
    expect(payPeriodFor("2026-03-15", cfg)).toEqual({ start: "2026-03-01", end: "2026-03-15" });
  });
});

describe("csv", () => {
  it("escapes quotes, commas and formula injection", () => {
    expect(toCsv([["a,b", 'say "hi"', "=SUM(A1)", 3, null]])).toBe(`"a,b","say ""hi""",'=SUM(A1),3,\r\n`);
  });
});

describe("outboxOp schema", () => {
  it("accepts a valid time.start and rejects unknown types", () => {
    const ok = outboxOp.safeParse({
      opId: "6f1c1a8e-4f7a-4b7e-9a51-1f2d3c4b5a69",
      type: "time.start",
      at: "2026-06-08T14:00:00.000Z",
      payload: { entryId: "0c7a1d2e-3b4c-4d5e-8f60-718293a4b5c6", taskId: "t1", projectId: "p1" },
    });
    expect(ok.success).toBe(true);
    expect(outboxOp.safeParse({ opId: "x", type: "nope", at: "", payload: {} }).success).toBe(false);
  });
});

import { localRangeToUtc, zonedTimeToUtc } from "../time";
describe("zonedTimeToUtc", () => {
  it("handles DST on both sides of the Nov 1 2026 change in Denver", () => {
    expect(zonedTimeToUtc("2026-10-30", 7 * 60, "America/Denver").toISOString()).toBe("2026-10-30T13:00:00.000Z");
    expect(zonedTimeToUtc("2026-11-02", 7 * 60, "America/Denver").toISOString()).toBe("2026-11-02T14:00:00.000Z");
  });
  it("builds a local range", () => {
    const r = localRangeToUtc("2026-11-01", "2026-11-07", "America/Denver");
    expect(r.gte.toISOString()).toBe("2026-11-01T06:00:00.000Z");
    expect(r.lt.toISOString()).toBe("2026-11-08T07:00:00.000Z");
  });
});
