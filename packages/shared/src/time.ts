/** Date helpers. Instants are UTC `Date`s; "local dates" are YYYY-MM-DD strings in an IANA zone. */

export type LocalDate = string; // YYYY-MM-DD

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

/** The calendar date of `instant` in `timeZone`, as YYYY-MM-DD. */
export function toLocalDate(instant: Date, timeZone: string): LocalDate {
  let fmt = dateFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dateFormatters.set(timeZone, fmt);
  }
  return fmt.format(instant);
}

export function parseLocalDate(d: LocalDate): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!match) throw new Error(`Invalid local date: ${d}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/** Days since 1970-01-01 for a local date (calendar arithmetic, zone-independent). */
export function localDateToDayNumber(d: LocalDate): number {
  const { y, m, d: day } = parseLocalDate(d);
  return Math.floor(Date.UTC(y, m - 1, day) / 86_400_000);
}

export function dayNumberToLocalDate(n: number): LocalDate {
  return new Date(n * 86_400_000).toISOString().slice(0, 10);
}

export function addDays(d: LocalDate, days: number): LocalDate {
  return dayNumberToLocalDate(localDateToDayNumber(d) + days);
}

/** 0 = Sunday … 6 = Saturday */
export function dayOfWeek(d: LocalDate): number {
  // 1970-01-01 was a Thursday (4).
  return (((localDateToDayNumber(d) + 4) % 7) + 7) % 7;
}

/** First day of the workweek containing `d`. */
export function startOfWeek(d: LocalDate, weekStartsOn: number): LocalDate {
  const diff = (dayOfWeek(d) - weekStartsOn + 7) % 7;
  return addDays(d, -diff);
}

export function minutesBetween(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

export function minutesToHours(minutes: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round((minutes / 60) * f) / f;
}

/** Offset of `timeZone` from UTC at `instant`, in minutes (local − UTC; e.g. −420 for MST). */
export function timeZoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/** The UTC instant of a wall-clock time (minutes after local midnight) on a local date in `timeZone`. */
export function zonedTimeToUtc(date: LocalDate, minutesOfDay: number, timeZone: string): Date {
  const { y, m, d } = parseLocalDate(date);
  const naive = Date.UTC(y, m - 1, d, 0, minutesOfDay);
  const o1 = timeZoneOffsetMinutes(new Date(naive), timeZone);
  let t = naive - o1 * 60_000;
  const o2 = timeZoneOffsetMinutes(new Date(t), timeZone);
  if (o2 !== o1) t = naive - o2 * 60_000;
  return new Date(t);
}

/** UTC instants bounding local dates [start, endInclusive] in `timeZone` (end is exclusive midnight after). */
export function localRangeToUtc(start: LocalDate, endInclusive: LocalDate, timeZone: string): { gte: Date; lt: Date } {
  return { gte: zonedTimeToUtc(start, 0, timeZone), lt: zonedTimeToUtc(addDays(endInclusive, 1), 0, timeZone) };
}
