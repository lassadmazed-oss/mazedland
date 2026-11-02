/**
 * « Le marché en chiffres » (/marche): what the public page reads, and how
 * the aggregation becomes the figures it shows.
 *
 * One SQL function (0207, public_market_stats) computes everything — counts,
 * medians, the trend, the demand — and applies the minimum-sample rule: a
 * median built from fewer than `public_stats_min_sample` prices comes back
 * null, with the count beside it. The shaping here never turns such a null
 * into a number; it arranges rows by category and governorate, computes the
 * change in percent where both sides exist, and gives each governorate the
 * anchor its catalogue page links to.
 *
 * The result is kept in analytics_cache for public_stats_cache_minutes, so a
 * page view costs one small read, and a settings change (the sample, the
 * window) gets its own key and so its own computation.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/log";

const mLog = log.scope("market");

export type Deal = "sale" | "rent";

/** One row of the aggregation: a level (all / category / governorate / both) for one deal. */
export type PriceRow = {
  gov: string | null;
  cat: string | null;
  deal: Deal;
  n: number;
  priced_n: number;
  median: number | null;
  sqm_n: number;
  sqm_median: number | null;
  recent_n: number;
  recent_median: number | null;
  prev_n: number;
  prev_median: number | null;
};

export type MarketRaw = {
  generated_at: string;
  window_days: number;
  min_sample: number;
  headline: { online: number; sale: number; rent: number; new_recent: number; new_prev: number; agences: number; governorates: number };
  categories: { slug: string; label_fr: string; label_ar: string | null; kind: string }[];
  prices: PriceRow[];
  bands: { deal: Deal; band: number; n: number }[];
  governorates: { gov: string; online: number; sale: number; rent: number }[];
  demand: {
    searches: number | null;
    visits: number | null;
    demandes: number | null;
    by_governorate: { gov: string; searches: number | null; visits: number | null; demandes: number | null }[];
  };
};

/** A figure and how many annonces stand behind it; `value` is null under the sample. */
export type Figure = { value: number | null; n: number };

/** The last window against the one before, in percent when both sides have the sample. */
export type Trend = { recent: Figure; prev: Figure; delta: number | null };

export type PriceCell = { n: number; median: Figure; sqm: Figure; trend: Trend };

export type CategoryStats = { slug: string; label: string; kind: string; online: number; sale: PriceCell; rent: PriceCell };

export type DemandFigures = { searches: number | null; visits: number | null; demandes: number | null };

export type GovernorateStats = {
  gov: string;
  /** The page anchor and the catalogue's link target: « ben-arous ». */
  slug: string;
  online: number;
  saleCount: number;
  rentCount: number;
  sale: PriceCell;
  rent: PriceCell;
  /** The categories with an annonce online there, most first. */
  categories: CategoryStats[];
  /** Null when no signal reaches the sample. */
  demand: DemandFigures | null;
};

export type MarketView = {
  generatedAt: string;
  windowDays: number;
  minSample: number;
  headline: MarketRaw["headline"] & { newDelta: number | null };
  all: { sale: PriceCell; rent: PriceCell };
  /** Every active category, those with annonces first. */
  categories: CategoryStats[];
  /** Counts per band (src/lib/analytics/shape.ts SALE_BANDS / RENT_BANDS), null when the deal lacks the sample. */
  bands: { sale: number[] | null; rent: number[] | null };
  governorates: GovernorateStats[];
  demand: DemandFigures & { byGovernorate: (DemandFigures & { gov: string; slug: string })[]; any: boolean };
};

const EMPTY_FIGURE: Figure = { value: null, n: 0 };

/**
 * The change from `prev` to `recent` in whole percent — null when either side
 * is missing or the base is nothing. Both figures come gated from SQL, so a
 * change is never computed from a median under the sample.
 */
export function percentChange(recent: number | null, prev: number | null): number | null {
  if (recent === null || prev === null || !(prev > 0)) return null;
  return Math.round(((recent - prev) / prev) * 100);
}

/**
 * A governorate's anchor: lower case, no accent, a dash for a space —
 * « Médenine » → « medenine », « Ben Arous » → « ben-arous ».
 */
export function governorateSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A figure only where the SQL left one: a null stays « not enough data », whatever the count says. */
function figure(value: number | null | undefined, n: number | undefined): Figure {
  const count = Number(n) || 0;
  return { value: value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value), n: count };
}

/** One row made into a cell; a missing row is an empty cell. */
export function cellOf(row: PriceRow | undefined): PriceCell {
  if (!row) return { n: 0, median: EMPTY_FIGURE, sqm: EMPTY_FIGURE, trend: { recent: EMPTY_FIGURE, prev: EMPTY_FIGURE, delta: null } };
  const recent = figure(row.recent_median, row.recent_n);
  const prev = figure(row.prev_median, row.prev_n);
  return {
    n: Number(row.n) || 0,
    median: figure(row.median, row.priced_n),
    sqm: figure(row.sqm_median, row.sqm_n),
    trend: { recent, prev, delta: percentChange(recent.value, prev.value) },
  };
}

/** The rows keyed by level, so a lookup never scans. */
function index(rows: readonly PriceRow[]): Map<string, PriceRow> {
  const m = new Map<string, PriceRow>();
  for (const r of rows) m.set(`${r.gov ?? ""}|${r.cat ?? ""}|${r.deal}`, r);
  return m;
}

const key = (gov: string | null, cat: string | null, deal: Deal) => `${gov ?? ""}|${cat ?? ""}|${deal}`;

function demandOf(d: { searches: number | null; visits: number | null; demandes: number | null } | undefined): DemandFigures | null {
  if (!d) return null;
  const out = { searches: d.searches ?? null, visits: d.visits ?? null, demandes: d.demandes ?? null };
  return out.searches === null && out.visits === null && out.demandes === null ? null : out;
}

/** The figures as the page shows them, in the reader's language. Pure. */
export function shapeMarket(raw: MarketRaw, locale: string): MarketView {
  const rows = index(raw.prices ?? []);
  const label = (c: { label_fr: string; label_ar: string | null }) => (locale === "ar" && c.label_ar ? c.label_ar : c.label_fr);
  const categoriesAt = (gov: string | null): CategoryStats[] =>
    (raw.categories ?? [])
      .map((c) => {
        const sale = cellOf(rows.get(key(gov, c.slug, "sale")));
        const rent = cellOf(rows.get(key(gov, c.slug, "rent")));
        return { slug: c.slug, label: label(c), kind: c.kind, online: sale.n + rent.n, sale, rent };
      })
      // Those with annonces first, most first; the registry's order breaks ties.
      .map((c, i) => ({ c, i }))
      .sort((a, b) => b.c.online - a.c.online || a.i - b.i)
      .map(({ c }) => c);

  const demandByGov = new Map((raw.demand?.by_governorate ?? []).map((d) => [d.gov, d]));
  const governorates: GovernorateStats[] = (raw.governorates ?? [])
    .filter((g) => g.online > 0)
    .map((g) => ({
      gov: g.gov,
      slug: governorateSlug(g.gov),
      online: g.online,
      saleCount: g.sale,
      rentCount: g.rent,
      sale: cellOf(rows.get(key(g.gov, null, "sale"))),
      rent: cellOf(rows.get(key(g.gov, null, "rent"))),
      categories: categoriesAt(g.gov).filter((c) => c.online > 0),
      demand: demandOf(demandByGov.get(g.gov)),
    }))
    .sort((a, b) => b.online - a.online || a.gov.localeCompare(b.gov));

  const bandsOf = (deal: Deal, size: number): number[] | null => {
    const mine = (raw.bands ?? []).filter((b) => b.deal === deal);
    if (mine.length === 0) return null;
    const out = Array.from({ length: size }, () => 0);
    for (const b of mine) if (b.band >= 1 && b.band <= size) out[b.band - 1] += Number(b.n) || 0;
    return out;
  };

  const byGovernorate = (raw.demand?.by_governorate ?? [])
    .map((d) => ({ gov: d.gov, slug: governorateSlug(d.gov), ...(demandOf(d) ?? { searches: null, visits: null, demandes: null }) }))
    .filter((d) => d.searches !== null || d.visits !== null || d.demandes !== null);
  const demand = {
    searches: raw.demand?.searches ?? null,
    visits: raw.demand?.visits ?? null,
    demandes: raw.demand?.demandes ?? null,
    byGovernorate,
  };

  return {
    generatedAt: raw.generated_at,
    windowDays: raw.window_days,
    minSample: raw.min_sample,
    headline: { ...raw.headline, newDelta: percentChange(raw.headline.new_recent, raw.headline.new_prev) },
    all: { sale: cellOf(rows.get(key(null, null, "sale"))), rent: cellOf(rows.get(key(null, null, "rent"))) },
    categories: categoriesAt(null),
    bands: { sale: bandsOf("sale", 6), rent: bandsOf("rent", 5) },
    governorates,
    demand: { ...demand, any: demand.searches !== null || demand.visits !== null || demand.demandes !== null || byGovernorate.length > 0 },
  };
}

// ── Reading it ───────────────────────────────────────────────────────────────

export type MarketOptions = { minSample: number; windowDays?: number; cacheMinutes: number };

/** The cache row's key: the figures depend on the sample and the window, so each pair has its own. */
export function marketCacheKey(minSample: number, windowDays: number): string {
  return `public_market:v1:min=${minSample}:win=${windowDays}`;
}

/**
 * The aggregation, from the cache while it is fresh, else computed and kept.
 * When the computation fails and a stale row exists, the stale row is served
 * (an hour-old market page beats a broken one); with nothing at all, the
 * error is thrown for the page to say so.
 */
export async function loadMarketStats(admin: SupabaseClient, opts: MarketOptions): Promise<{ raw: MarketRaw; cached: boolean }> {
  const windowDays = opts.windowDays ?? 30;
  const cacheKey = marketCacheKey(opts.minSample, windowDays);
  const now = Date.now();
  let stale: MarketRaw | null = null;
  try {
    const { data: row } = await admin.from("analytics_cache").select("value, fetched_at").eq("key", cacheKey).maybeSingle();
    if (row) {
      const age = now - Date.parse(row.fetched_at as string);
      if (age < opts.cacheMinutes * 60_000) return { raw: row.value as MarketRaw, cached: true };
      stale = row.value as MarketRaw;
    }
  } catch (e) {
    mLog.warn(`cache read failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const { data, error } = await admin.rpc("public_market_stats", { p_min_sample: opts.minSample, p_window_days: windowDays });
  if (error || !data) {
    mLog.error(`public_market_stats failed: ${error?.message ?? "no data"}`);
    if (stale) return { raw: stale, cached: true };
    throw new Error(error?.message ?? "public_market_stats: no data");
  }
  const raw = data as MarketRaw;
  const { error: writeError } = await admin.from("analytics_cache").upsert({ key: cacheKey, value: raw, fetched_at: new Date(now).toISOString() });
  if (writeError) mLog.warn(`cache write failed: ${writeError.message}`);
  return { raw, cached: false };
}
