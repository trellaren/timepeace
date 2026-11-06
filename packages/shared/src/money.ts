/** All money is integer cents. Rates/percentages are basis points (1% = 100 bps). */
export type Cents = number;

export function dollarsToCents(input: string | number): Cents {
  const s = typeof input === "number" ? input.toFixed(2) : input.trim().replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d{0,2})?$/.test(s)) throw new Error(`Invalid dollar amount: ${input}`);
  const negative = s.startsWith("-");
  const [whole = "0", frac = ""] = s.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return negative ? -cents : cents;
}

export function formatCents(cents: Cents, opts: { showCents?: boolean } = {}): string {
  const showCents = opts.showCents ?? true;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  }).format(cents / 100);
}

/** Multiply cents by basis points, rounding half away from zero. */
export function applyBps(cents: Cents, bps: number): Cents {
  return roundHalfAwayFromZero((cents * bps) / 10_000);
}

export function roundHalfAwayFromZero(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(n));
}

/** Cost of `minutes` of work at an hourly rate, rounded to the cent. */
export function minutesToCost(minutes: number, hourlyRateCents: Cents): Cents {
  return roundHalfAwayFromZero((minutes * hourlyRateCents) / 60);
}

export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0;
  for (const v of values) total += v;
  return total;
}
