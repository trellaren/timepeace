import { minutesBetween, startOfWeek, toLocalDate, type LocalDate } from "./time";

/**
 * Overtime rules. Defaults follow the federal FLSA (OT after 40 hours per workweek).
 * Some states add daily rules; California is provided as a preset. Payroll providers
 * remain the system of record for pay. This is used for approval-time totals and exports.
 */
export interface OvertimeRules {
  weeklyOtThresholdMinutes: number | null;
  dailyOtThresholdMinutes: number | null;
  dailyDtThresholdMinutes: number | null;
  /** CA: 7th consecutive workday in a workweek → first 8h OT, beyond 8h DT. */
  seventhDayRule: boolean;
  /** Workweek start, 0 = Sunday. */
  weekStartsOn: number;
  /** Breaks shorter than this stay paid (FLSA rest breaks). Default 20. */
  minUnpaidBreakMinutes?: number;
}

export const FLSA_RULES: OvertimeRules = {
  weeklyOtThresholdMinutes: 40 * 60,
  dailyOtThresholdMinutes: null,
  dailyDtThresholdMinutes: null,
  seventhDayRule: false,
  weekStartsOn: 0,
};

export const CALIFORNIA_RULES: OvertimeRules = {
  weeklyOtThresholdMinutes: 40 * 60,
  dailyOtThresholdMinutes: 8 * 60,
  dailyDtThresholdMinutes: 12 * 60,
  seventhDayRule: true,
  weekStartsOn: 0,
};

export interface WorkInterval {
  start: Date;
  end: Date;
  breakMinutes?: number;
}

export interface DayBreakdown {
  date: LocalDate;
  workedMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
  doubleTimeMinutes: number;
}

export interface OvertimeResult {
  totalMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
  doubleTimeMinutes: number;
  days: DayBreakdown[];
}

/** Net worked minutes of an interval (breaks deducted, never negative). */
export function workedMinutes(i: WorkInterval): number {
  return Math.max(0, minutesBetween(i.start, i.end) - (i.breakMinutes ?? 0));
}

/**
 * Classify worked time into regular / OT / double-time.
 * An interval is attributed to the local workday on which it started.
 * Daily OT/DT minutes don't also count toward the weekly threshold (no pyramiding).
 */
export function computeOvertime(
  intervals: WorkInterval[],
  rules: OvertimeRules,
  timeZone: string,
): OvertimeResult {
  const byDay = new Map<LocalDate, number>();
  for (const i of intervals) {
    const d = toLocalDate(i.start, timeZone);
    byDay.set(d, (byDay.get(d) ?? 0) + workedMinutes(i));
  }

  const byWeek = new Map<LocalDate, LocalDate[]>();
  for (const d of [...byDay.keys()].sort()) {
    const wk = startOfWeek(d, rules.weekStartsOn);
    const list = byWeek.get(wk) ?? [];
    list.push(d);
    byWeek.set(wk, list);
  }

  const days: DayBreakdown[] = [];
  for (const [, weekDays] of [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const daysWorked = weekDays.filter((d) => (byDay.get(d) ?? 0) > 0).length;
    let weeklyRegular = 0;

    weekDays.forEach((date, idx) => {
      const worked = byDay.get(date) ?? 0;
      let reg = worked;
      let ot = 0;
      let dt = 0;

      const isSeventhDay = rules.seventhDayRule && daysWorked === 7 && idx === 6;
      if (isSeventhDay) {
        reg = 0;
        ot = Math.min(worked, 8 * 60);
        dt = Math.max(0, worked - 8 * 60);
      } else {
        if (rules.dailyDtThresholdMinutes != null && worked > rules.dailyDtThresholdMinutes) {
          dt = worked - rules.dailyDtThresholdMinutes;
        }
        if (rules.dailyOtThresholdMinutes != null && worked > rules.dailyOtThresholdMinutes) {
          ot = worked - dt - rules.dailyOtThresholdMinutes;
        }
        reg = worked - ot - dt;
      }

      if (rules.weeklyOtThresholdMinutes != null) {
        const room = Math.max(0, rules.weeklyOtThresholdMinutes - weeklyRegular);
        if (reg > room) {
          ot += reg - room;
          reg = room;
        }
      }
      weeklyRegular += reg;

      days.push({
        date,
        workedMinutes: worked,
        regularMinutes: reg,
        overtimeMinutes: ot,
        doubleTimeMinutes: dt,
      });
    });
  }

  const sum = (k: keyof Omit<DayBreakdown, "date">) => days.reduce((a, d) => a + d[k], 0);
  return {
    totalMinutes: sum("workedMinutes"),
    regularMinutes: sum("regularMinutes"),
    overtimeMinutes: sum("overtimeMinutes"),
    doubleTimeMinutes: sum("doubleTimeMinutes"),
    days,
  };
}

/** No overtime (e.g. 1099 contractors, who are not covered by FLSA overtime). */
export const NO_OVERTIME_RULES: OvertimeRules = {
  weeklyOtThresholdMinutes: null,
  dailyOtThresholdMinutes: null,
  dailyDtThresholdMinutes: null,
  seventhDayRule: false,
  weekStartsOn: 0,
};

/** Estimated gross wages: regular × rate + OT × 1.5 × rate + DT × 2 × rate, using the rate in effect each day. */
export function grossPayCents(days: DayBreakdown[], rateForDate: (d: LocalDate) => number): number {
  let total = 0;
  for (const d of days) {
    const rate = rateForDate(d.date);
    total += (rate * (d.regularMinutes + d.overtimeMinutes * 1.5 + d.doubleTimeMinutes * 2)) / 60;
  }
  return Math.round(total);
}
