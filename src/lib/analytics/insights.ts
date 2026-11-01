/**
 * The insights at the top of /admin/analytics: what moved, what is odd, and
 * what to do about it — one sentence each, with the number and a link to the
 * filtered console page. Pure rules over the aggregates the page already
 * holds, so they are tested without a database.
 *
 * Every threshold is a setting (src/lib/settings/registry.ts, analytics_*):
 * the owner tunes what counts as a mover, an anomaly, a search worth a
 * category, an annonce that gets looks and no calls, an agence slow to
 * answer, a governorate that lacks annonces.
 */
import type { ReactiveRules } from "@/lib/pro/reactivity";

export type Kpis = Record<string, number | string>;

export type InsightKind =
  | "mover_up"
  | "mover_down"
  | "anomaly_high"
  | "anomaly_low"
  | "zero_search"
  | "no_contact"
  | "slow_agence"
  | "gov_gap"
  | "expiring"
  | "pending_payments"
  | "no_photo";

export type Insight = {
  kind: InsightKind;
  /** "good" is worth a smile, "warn" a look, "bad" an action. */
  tone: "good" | "warn" | "bad";
  /** The metric or the thing the sentence is about (a KPI key, a search, an annonce id). */
  subject: string;
  /** The message's placeholders: the number, the delta, a name. */
  values: Record<string, string | number>;
  /** Where to act, as a console path with its query string. */
  href: string;
  /** For the order: the bigger, the higher on the page. */
  weight: number;
};

export type InsightRules = {
  /** analytics_mover_min_percent */
  moverMinPercent: number;
  /** analytics_anomaly_sigma */
  anomalySigma: number;
  /** analytics_zero_search_min */
  zeroSearchMin: number;
  /** analytics_no_contact_min_views */
  noContactMinViews: number;
  /** analytics_gov_demand_min */
  govDemandMin: number;
  /** analytics_gov_low_supply */
  govLowSupply: number;
  /** The « Agence réactive » rules (reactive_*). */
  reactive: ReactiveRules;
  /** How many insights at most. */
  limit: number;
};

/** The KPIs the movers and anomalies watch, in the order they are reported. */
export const WATCHED_KPIS = [
  "page_views", "visitors", "searches", "listing_views", "publishes", "listings_new",
  "reveals", "visit_requests", "favourites", "demandes", "signups", "revenue",
] as const;

/** Mean and sample standard deviation; null with fewer than three points. */
export function meanAndSd(values: readonly number[]): { mean: number; sd: number } | null {
  const xs = values.filter((v) => Number.isFinite(v));
  if (xs.length < 3) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
  return { mean, sd: Math.sqrt(variance) };
}

export type InsightInput = {
  /** The latest full week and the one before (analytics_weekly, last two). */
  thisWeek: Kpis;
  lastWeek: Kpis;
  /** The eight weeks before this one (the baseline), oldest first. */
  baseline: readonly Kpis[];
  zeroSearches: readonly { q: string; n: number }[];
  topListings: readonly { id: string; title: string; reference: string | null; views: number; reveals: number; visits: number; status: string }[];
  agences: readonly { id: string; name: string; slug: string; total: number; answered: number; fast: number; late: number; avg_hours: number | null }[];
  governorates: readonly { gov: string; online: number; searches: number; views: number; demandes: number }[];
  expiring: number;
  pendingPayments: { n: number; amount: number };
  noPhoto: number;
  rules: InsightRules;
};

/** The console path that lists the thing an insight points at. */
const HREF = {
  listings: "/admin/annonces",
  payments: "/admin/paiements",
  agences: "/admin/agences",
  demandes: "/admin/demandes",
  catalogue: "/admin/catalogue",
  analytics: "/admin/analytics",
} as const;

export function buildInsights(input: InsightInput): Insight[] {
  const out: Insight[] = [];
  const { rules } = input;

  // Movers: the latest week against the one before, by percent.
  for (const key of WATCHED_KPIS) {
    const cur = Number(input.thisWeek[key] ?? 0);
    const prev = Number(input.lastWeek[key] ?? 0);
    if (prev <= 0 || cur === prev) continue;
    const pct = Math.round(((cur - prev) / prev) * 100);
    if (Math.abs(pct) < rules.moverMinPercent) continue;
    // A move from two to three is not news.
    if (Math.max(cur, prev) < 5) continue;
    out.push({
      kind: pct > 0 ? "mover_up" : "mover_down",
      tone: pct > 0 ? "good" : "warn",
      subject: key,
      values: { value: cur, previous: prev, pct: Math.abs(pct) },
      href: `${HREF.analytics}?p=7`,
      weight: Math.min(100, Math.abs(pct)) + (key === "revenue" || key === "reveals" ? 20 : 0),
    });
  }

  // Anomalies: the latest week against its 8-week baseline.
  for (const key of WATCHED_KPIS) {
    const stats = meanAndSd(input.baseline.map((w) => Number(w[key] ?? 0)));
    if (!stats || stats.sd === 0) continue;
    const cur = Number(input.thisWeek[key] ?? 0);
    const z = (cur - stats.mean) / stats.sd;
    if (Math.abs(z) < rules.anomalySigma) continue;
    if (out.some((i) => i.subject === key && i.kind.startsWith("mover"))) continue; // already said
    out.push({
      kind: z > 0 ? "anomaly_high" : "anomaly_low",
      tone: z > 0 ? "good" : "bad",
      subject: key,
      values: { value: cur, mean: Math.round(stats.mean), sigma: Math.round(Math.abs(z) * 10) / 10 },
      href: `${HREF.analytics}?p=90`,
      weight: 60 + Math.min(40, Math.abs(z) * 10),
    });
  }

  // Searches with no result, repeated: a category, a place or a spelling to add.
  for (const s of input.zeroSearches) {
    if (s.n < rules.zeroSearchMin) continue;
    out.push({
      kind: "zero_search",
      tone: "warn",
      subject: s.q,
      values: { query: s.q, count: s.n },
      href: `${HREF.catalogue}`,
      weight: 40 + Math.min(40, s.n * 2),
    });
  }

  // Annonces that get looks and no contact: a price or photos to review.
  for (const l of input.topListings) {
    if (l.status !== "published" || l.views < rules.noContactMinViews || l.reveals + l.visits > 0) continue;
    out.push({
      kind: "no_contact",
      tone: "warn",
      subject: l.id,
      values: { title: l.title, reference: l.reference ?? "", views: l.views },
      href: `${HREF.listings}?q=${encodeURIComponent(l.reference ?? l.title)}`,
      weight: 30 + Math.min(40, l.views / 5),
    });
  }

  // Agences slow to answer visit requests: below the badge's own bar.
  for (const a of input.agences) {
    const judged = a.answered + a.late;
    if (judged < rules.reactive.minRequests) continue;
    const rate = Math.round((a.fast / judged) * 100);
    if (rate >= rules.reactive.minRate) continue;
    out.push({
      kind: "slow_agence",
      tone: "bad",
      subject: a.id,
      values: { name: a.name, rate, hours: rules.reactive.hours, late: a.late, avgHours: a.avg_hours ?? 0 },
      href: `${HREF.agences}?q=${encodeURIComponent(a.slug)}`,
      weight: 50 + (rules.reactive.minRate - rate),
    });
  }

  // Governorates people search and few annonces answer.
  for (const g of input.governorates) {
    const demand = g.searches + g.demandes;
    if (demand < rules.govDemandMin || g.online >= rules.govLowSupply) continue;
    out.push({
      kind: "gov_gap",
      tone: "warn",
      subject: g.gov,
      values: { gov: g.gov, searches: g.searches, demandes: g.demandes, online: g.online },
      href: `${HREF.demandes}?gov=${encodeURIComponent(g.gov)}`,
      weight: 35 + Math.min(40, demand / 2),
    });
  }

  if (input.expiring > 0) {
    out.push({ kind: "expiring", tone: "warn", subject: "expiring", values: { count: input.expiring }, href: `${HREF.listings}?status=expiring`, weight: 25 + Math.min(20, input.expiring) });
  }
  if (input.pendingPayments.n > 0) {
    out.push({ kind: "pending_payments", tone: "bad", subject: "payments", values: { count: input.pendingPayments.n, amount: input.pendingPayments.amount }, href: HREF.payments, weight: 70 + Math.min(20, input.pendingPayments.n * 2) });
  }
  if (input.noPhoto > 0) {
    out.push({ kind: "no_photo", tone: "warn", subject: "no_photo", values: { count: input.noPhoto }, href: `${HREF.listings}?status=published`, weight: 20 + Math.min(20, input.noPhoto) });
  }

  return out.sort((a, b) => b.weight - a.weight).slice(0, Math.max(1, rules.limit));
}

/** The settings as rules. */
export function insightRules(
  s: {
    analytics_mover_min_percent: number;
    analytics_anomaly_sigma: number;
    analytics_zero_search_min: number;
    analytics_no_contact_min_views: number;
    analytics_gov_demand_min: number;
    analytics_gov_low_supply: number;
  },
  reactive: ReactiveRules,
  limit = 8,
): InsightRules {
  return {
    moverMinPercent: s.analytics_mover_min_percent,
    anomalySigma: s.analytics_anomaly_sigma,
    zeroSearchMin: s.analytics_zero_search_min,
    noContactMinViews: s.analytics_no_contact_min_views,
    govDemandMin: s.analytics_gov_demand_min,
    govLowSupply: s.analytics_gov_low_supply,
    reactive,
    limit,
  };
}
