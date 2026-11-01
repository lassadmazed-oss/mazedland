/**
 * The period a statistics page shows: the last 7, 30 or 90 days, or two
 * dates, always compared with the period of the same length just before.
 *
 * Days are Tunisian days. Tunisia has kept UTC+1 all year since 2008, so the
 * fixed offset is exact and needs no time-zone tables in the browser.
 * Pure: the same inputs give the same dates, so it is tested.
 */

export const PERIOD_KEYS = ["7", "30", "90", "custom"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

export type Period = {
  key: PeriodKey;
  /** The first moment shown (midnight in Tunis of the first day). */
  from: Date;
  /** The first moment not shown: now, or midnight after the last day. */
  to: Date;
  prevFrom: Date;
  prevTo: Date;
  /** Whole days in the period. */
  days: number;
  /** The dates as the picker shows them, YYYY-MM-DD in Tunis. */
  fromDay: string;
  toDay: string;
};

const TUNIS_OFFSET_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** "2026-11-01" in Tunis for a moment. */
export function tunisDay(d: Date): string {
  return new Date(d.getTime() + TUNIS_OFFSET_MS).toISOString().slice(0, 10);
}

/** Midnight in Tunis of a YYYY-MM-DD day, as an instant. Null when the text is not a day. */
export function tunisMidnight(day: string | undefined | null): Date | null {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const t = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t - TUNIS_OFFSET_MS);
  // A day that does not exist (2026-02-31) rolls over: refuse it.
  return tunisDay(d) === day ? d : null;
}

export function isPeriodKey(v: unknown): v is PeriodKey {
  return typeof v === "string" && (PERIOD_KEYS as readonly string[]).includes(v);
}

/**
 * The period for the page's query string. « 30 » is the 30 Tunisian days
 * ending today, today included and still running; a custom period is whole
 * days, from the first to the last included. Anything odd reads as 30 days;
 * a custom period longer than 366 days or ending before it starts does too.
 */
export function resolvePeriod(sp: { p?: string; from?: string; to?: string }, now: Date = new Date()): Period {
  const key: PeriodKey = isPeriodKey(sp.p) ? sp.p : "30";
  if (key === "custom") {
    const from = tunisMidnight(sp.from);
    const toStart = tunisMidnight(sp.to);
    if (from && toStart && toStart.getTime() >= from.getTime()) {
      const to = new Date(Math.min(toStart.getTime() + DAY_MS, now.getTime() + DAY_MS));
      const days = Math.round((to.getTime() - from.getTime()) / DAY_MS);
      if (days >= 1 && days <= 366) return build("custom", from, to, days);
    }
    return resolvePeriod({ p: "30" }, now);
  }
  const days = Number(key);
  const todayStart = tunisMidnight(tunisDay(now))!;
  const from = new Date(todayStart.getTime() - (days - 1) * DAY_MS);
  return build(key, from, now, days);
}

function build(key: PeriodKey, from: Date, to: Date, days: number): Period {
  const length = to.getTime() - from.getTime();
  const prevTo = from;
  const prevFrom = new Date(from.getTime() - length);
  return {
    key, from, to, prevFrom, prevTo, days,
    fromDay: tunisDay(from),
    toDay: tunisDay(new Date(to.getTime() - 1)),
  };
}

/** The change from `prev` to `cur` in percent, null when there is nothing to compare with. */
export function pctChange(cur: number, prev: number): number | null {
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
}

/** The page's query string for a period and a tab. */
export function periodQuery(period: Pick<Period, "key" | "fromDay" | "toDay">, extra: Record<string, string | undefined> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
  if (period.key === "custom") {
    q.set("p", "custom");
    q.set("from", period.fromDay);
    q.set("to", period.toDay);
  } else if (period.key !== "30") {
    q.set("p", period.key);
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Every day of a period, in order, YYYY-MM-DD. */
export function daysOf(period: Pick<Period, "from" | "to">): string[] {
  const out: string[] = [];
  for (let t = period.from.getTime(); t < period.to.getTime(); t += DAY_MS) out.push(tunisDay(new Date(t)));
  return out;
}
