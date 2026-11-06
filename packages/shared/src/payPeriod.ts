import type { PayPeriodType } from "./enums";
import { addDays, localDateToDayNumber, parseLocalDate, startOfWeek, type LocalDate } from "./time";

export interface PayPeriodConfig {
  type: PayPeriodType;
  /** For WEEKLY: ignored except for weekday. For BIWEEKLY: the start date of any real pay period. */
  anchorDate: LocalDate;
  /** 0 = Sunday. Used for WEEKLY periods and as the FLSA workweek start. */
  weekStartsOn: number;
}

export interface PayPeriodRange {
  start: LocalDate;
  /** Inclusive. */
  end: LocalDate;
}

export function payPeriodFor(date: LocalDate, cfg: PayPeriodConfig): PayPeriodRange {
  switch (cfg.type) {
    case "WEEKLY": {
      const start = startOfWeek(date, cfg.weekStartsOn);
      return { start, end: addDays(start, 6) };
    }
    case "BIWEEKLY": {
      const anchor = localDateToDayNumber(cfg.anchorDate);
      const diff = localDateToDayNumber(date) - anchor;
      const idx = Math.floor(diff / 14);
      const start = addDays(cfg.anchorDate, idx * 14);
      return { start, end: addDays(start, 13) };
    }
    case "SEMIMONTHLY": {
      const { y, m, d } = parseLocalDate(date);
      const mm = String(m).padStart(2, "0");
      if (d <= 15) return { start: `${y}-${mm}-01`, end: `${y}-${mm}-15` };
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      return { start: `${y}-${mm}-16`, end: `${y}-${mm}-${lastDay}` };
    }
  }
}

export function previousPayPeriod(current: PayPeriodRange, cfg: PayPeriodConfig): PayPeriodRange {
  return payPeriodFor(addDays(current.start, -1), cfg);
}
