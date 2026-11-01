/**
 * The small, pure arithmetic between the aggregates and the page: funnel
 * drop-offs, price bands, rates, the series a sparkline draws. Tested.
 */

export type FunnelStep = { key: string; value: number; /** Share of the first step, in percent. */ share: number; /** Lost since the step before, in percent of it; null when nothing was lost. */ drop: number | null };

/** Each step with its share of the first and what the step before lost. */
export function funnelSteps(steps: readonly { key: string; value: number }[]): FunnelStep[] {
  const first = steps[0]?.value ?? 0;
  return steps.map((s, i) => {
    const prev = i > 0 ? steps[i - 1].value : null;
    const lost = prev !== null && prev > 0 && s.value < prev ? Math.round(((prev - s.value) / prev) * 100) : null;
    return {
      key: s.key,
      value: s.value,
      share: first > 0 ? Math.round((s.value / first) * 100) : 0,
      drop: lost !== null && lost > 0 ? lost : null,
    };
  });
}

/** The price bands the marketplace aggregation uses (0204), in dinars. */
export const SALE_BANDS = [
  { band: 1, max: 50_000 },
  { band: 2, max: 100_000 },
  { band: 3, max: 200_000 },
  { band: 4, max: 400_000 },
  { band: 5, max: 800_000 },
  { band: 6, max: null },
] as const;
export const RENT_BANDS = [
  { band: 1, max: 300 },
  { band: 2, max: 600 },
  { band: 3, max: 1_000 },
  { band: 4, max: 2_000 },
  { band: 5, max: null },
] as const;

/** "< 50 000", "50 000 – 100 000", "> 800 000" for a band, with the numbers already formatted by the caller. */
export function bandLabel(deal: "sale" | "rent", band: number, fmt: (n: number) => string): string {
  const bands: readonly { band: number; max: number | null }[] = deal === "rent" ? RENT_BANDS : SALE_BANDS;
  const i = bands.findIndex((b) => b.band === band);
  if (i < 0) return String(band);
  const lower = i > 0 ? bands[i - 1].max : null;
  const upper = bands[i].max;
  if (lower === null && upper !== null) return `< ${fmt(upper)}`;
  if (upper === null && lower !== null) return `≥ ${fmt(lower)}`;
  return `${fmt(lower ?? 0)} – ${fmt(upper ?? 0)}`;
}

/** A rate in percent, null without a denominator. */
export function rate(num: number, den: number): number | null {
  return den > 0 ? Math.round((num / den) * 1000) / 10 : null;
}

/** The values of one key across a day series, in order. */
export function pick(series: readonly Record<string, unknown>[], key: string): number[] {
  return series.map((d) => Number(d[key]) || 0);
}

export function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/** Retention of a cohort in percent, null while its week has not passed. */
export function retention(active: number | null, size: number): number | null {
  if (active === null || size <= 0) return null;
  return Math.round((active / size) * 100);
}

/** Groups the price bands by category and deal, every band present (0 when empty). */
export function bandTable(
  rows: readonly { category: string; deal: string; band: number; n: number }[],
): { category: string; deal: "sale" | "rent"; bands: number[]; total: number }[] {
  const map = new Map<string, { category: string; deal: "sale" | "rent"; bands: number[] }>();
  for (const r of rows) {
    const deal = r.deal === "rent" ? "rent" : "sale";
    const key = `${r.category}|${deal}`;
    const size = deal === "rent" ? RENT_BANDS.length : SALE_BANDS.length;
    const entry = map.get(key) ?? { category: r.category, deal, bands: Array.from({ length: size }, () => 0) };
    if (r.band >= 1 && r.band <= size) entry.bands[r.band - 1] += r.n;
    map.set(key, entry);
  }
  return [...map.values()].map((e) => ({ ...e, total: sum(e.bands) })).sort((a, b) => b.total - a.total);
}
