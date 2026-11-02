/**
 * What /admin/analytics reads: the aggregations of 0204, called with the
 * service client after requireAdmin('analytics'), and Google's reports
 * through the cache table. Every call returns the shape the SQL builds;
 * the page only formats.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/log";
import type { Period } from "./period";
import { fetchGa4Data, parseServiceAccount, type Ga4Data, type ServiceAccount } from "./ga4-data";

const qLog = log.scope("analytics");

export type Kpis = {
  page_views: number; visitors: number; listing_views: number; searches: number;
  listings_online: number; listings_new: number; publishes: number; reveals: number;
  visit_requests: number; favourites: number; demandes: number; signups: number;
  agences_new: number; agences_open: number; revenue: number; paid_count: number;
};

export type DayPoint = {
  day: string; page_views: number; visitors: number; listing_views: number; searches: number;
  listings_new: number; publishes: number; reveals: number; visit_requests: number;
  favourites: number; signups: number; revenue: number;
};

export type WeekPoint = Kpis & { from: string; to: string };

export type Marketplace = {
  by_status: Record<string, number>;
  by_deal: { deal: string; online: number; new: number; published: number }[];
  by_category: { slug: string; label_fr: string; label_ar: string | null; kind: string; online: number; published: number; new: number; views: number; reveals: number; median_sale: number | null; median_rent: number | null }[];
  by_governorate: { gov: string; online: number; published: number; views: number; searches: number; reveals: number; demandes: number }[];
  price_bands: { category: string; deal: string; band: number; n: number }[];
  time_to_publish: { n: number; avg_hours: number | null; median_hours: number | null };
  funnel: { start: number; category: number; details: number; photos: number; review: number; submitted: number; published: number; abandoned: number; drafts: number };
  moderation: { submitted: number; auto_published: number; approved: number; rejected: number; archived: number; edits_approved: number; edits_rejected: number; reports: number; pending_now: number; review_median_hours: number | null };
  quality: { online: number; no_photo: number; no_price: number; expiring: number; expiring_list: { id: string; title: string; reference: string | null; expires_at: string }[] };
};

export type Demand = {
  searches: number;
  searchers: number;
  top_searches: { q: string; n: number; avg_results: number | null; zero: number }[];
  zero_searches: { q: string; n: number }[];
  zero_total: number;
  understood: { yes: number; no: number; unknown: number };
  catalogue_views: number;
  filters: { filter: string; n: number }[];
  sorts: { sort: string; n: number }[];
  top_listings: { id: string; title: string; reference: string | null; status: string; deal: string; governorate: string; price: number | null; shop_id: string | null; views: number; unique_viewers: number; reveals: number; favourites: number; visits: number }[];
  top_agences: { id: string; name: string; slug: string; kind: string; governorate: string; status: string; views: number; contacts: number; listings_online: number; listing_views: number; reveals: number; visits: number }[];
  visits: { total: number; waiting: number; confirmed: number; declined: number; cancelled: number; done: number; answered: number; fast: number; late: number; avg_answer_hours: number | null; median_answer_hours: number | null };
  visits_by_agence: { id: string; name: string; slug: string; total: number; answered: number; fast: number; late: number; avg_hours: number | null }[];
  favourites: number;
  compare: { adds: number; users: number; opens: number };
  demandes: number;
  matches: number;
  shares: number;
  credit_simulator: { opens: number; uses: number };
};

export type Pro = {
  by_plan: { slug: string; name_fr: string; name_ar: string | null; price: number; duration_days: number | null; quota: number | null; agences: number; offered: number }[];
  no_plan: number;
  agences: { approved: number; pending: number; suspended: number; rejected: number; verified: number; new: number; by_kind: Record<string, number> };
  mrr: number;
  mrr_offered: number;
  ending_soon: number;
  payments: { status: string; n: number; amount: number }[];
  pending_now: { n: number; amount: number };
  revenue_by_kind: { kind: string; n: number; amount: number }[];
  revenue_by_provider: { provider: string; n: number; amount: number }[];
  invoices: { invoices: number; invoices_amount: number; credit_notes: number; credit_notes_amount: number };
  plan_changes: { slug: string; name_fr: string; name_ar: string | null; paid: number; offered: number }[];
  offers: number;
  imports: { files: number; rows: number };
  social: { status: string; n: number }[];
  social_revenue: number;
  ai: { calls: number; failed: number; cost_usd: number };
};

export type Users = {
  signups: number;
  signups_by_day: { day: string; fr: number; ar: number; other: number }[];
  by_locale: Record<string, number>;
  by_role: Record<string, number>;
  by_device: Record<string, number>;
  logins: number;
  active: { period: number; d7: number; d30: number };
  accounts_total: number;
  deleted: number;
  cohorts: { from: string; to: string; size: number; w1: number | null; w4: number | null }[];
  consent: { granted: number; denied: number };
  install: { shown: number; click: number; done: number };
  language_switches: number;
  errors: { not_found: number; client: number; uploads: number };
  by_locale_events: Record<string, number>;
  by_device_events: Record<string, number>;
};

async function rpc<T>(admin: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(fn, args);
  if (error) {
    qLog.error(`${fn} failed: ${error.message}`);
    throw new Error(`${fn}: ${error.message}`);
  }
  return data as T;
}

const iso = (d: Date) => d.toISOString();

export const kpis = (admin: SupabaseClient, from: Date, to: Date) => rpc<Kpis>(admin, "analytics_kpis", { p_from: iso(from), p_to: iso(to) });
export const series = (admin: SupabaseClient, p: Period) => rpc<DayPoint[]>(admin, "analytics_series", { p_from: iso(p.from), p_to: iso(p.to) });
export const weekly = (admin: SupabaseClient, to: Date, weeks = 9) => rpc<WeekPoint[]>(admin, "analytics_weekly", { p_to: iso(to), p_weeks: weeks });
export const marketplace = (admin: SupabaseClient, p: Period, expiringDays: number) =>
  rpc<Marketplace>(admin, "analytics_marketplace", { p_from: iso(p.from), p_to: iso(p.to), p_expiring_days: expiringDays });
export const demand = (admin: SupabaseClient, p: Period, limit: number, fastHours: number) =>
  rpc<Demand>(admin, "analytics_demand", { p_from: iso(p.from), p_to: iso(p.to), p_limit: limit, p_fast_hours: fastHours });
export const pro = (admin: SupabaseClient, p: Period) => rpc<Pro>(admin, "analytics_pro", { p_from: iso(p.from), p_to: iso(p.to) });
export const users = (admin: SupabaseClient, p: Period) => rpc<Users>(admin, "analytics_users", { p_from: iso(p.from), p_to: iso(p.to) });

// ── Google ───────────────────────────────────────────────────────────────────

export type Ga4Status =
  | { state: "no_key" }
  | { state: "no_property" }
  | { state: "ready"; account: ServiceAccount; propertyId: string };

/** Whether the console can read Google: the key in the environment and the property in the settings. */
export function ga4Status(propertyId: string): Ga4Status {
  const account = parseServiceAccount(process.env.GA4_SERVICE_ACCOUNT_JSON);
  if (!account) return { state: "no_key" };
  if (!/^[0-9]{5,15}$/.test(propertyId)) return { state: "no_property" };
  return { state: "ready", account, propertyId };
}

export type Ga4Result = { data: Ga4Data; cached: boolean; fetchedAt: string } | { data: null; error: string };

/**
 * Google's reports for a period, from the cache while they are fresh
 * (analytics_ga_cache_minutes), else fetched and kept. A failure is returned
 * as words, never thrown: the page stays complete without Google.
 */
export async function ga4Reports(
  admin: SupabaseClient,
  status: Extract<Ga4Status, { state: "ready" }>,
  p: Period,
  ttlMinutes: number,
  limit: number,
): Promise<Ga4Result> {
  const key = `ga4:${status.propertyId}:${p.fromDay}:${p.toDay}:${limit}`;
  const now = Date.now();
  try {
    const { data: row } = await admin.from("analytics_cache").select("value, fetched_at").eq("key", key).maybeSingle();
    if (row && now - Date.parse(row.fetched_at as string) < ttlMinutes * 60_000) {
      return { data: row.value as Ga4Data, cached: true, fetchedAt: row.fetched_at as string };
    }
  } catch (e) {
    qLog.warn(`cache read failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    const data = await fetchGa4Data({ propertyId: status.propertyId, account: status.account, from: p.from, to: p.to, prevFrom: p.prevFrom, prevTo: p.prevTo, limit });
    const { error } = await admin.from("analytics_cache").upsert({ key, value: data, fetched_at: new Date(now).toISOString() });
    if (error) qLog.warn(`cache write failed: ${error.message}`);
    return { data, cached: false, fetchedAt: data.fetchedAt };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    qLog.warn(`google failed: ${msg}`);
    return { data: null, error: msg };
  }
}
