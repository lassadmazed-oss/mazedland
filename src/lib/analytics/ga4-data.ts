/**
 * Google Analytics 4 reports, read with the Data API and a service account
 * — no SDK: a JWT signed here with Node's crypto (RS256), exchanged for an
 * access token, then `properties/{id}:runReport`.
 *
 * What it needs: the property's numeric ID (the setting
 * analytics_ga_property_id) and the service account's key file as the
 * GA4_SERVICE_ACCOUNT_JSON environment variable (the JSON as is, or base64),
 * with that account added as a Viewer on the property. Nothing here is
 * secret in the browser: it runs on the server, for the console only.
 *
 * The pure parts (reading the key, the claims, the report's shape) are
 * tested; the network calls take a `fetch` they can be given a fake of.
 */
import { createSign } from "node:crypto";
import { tunisDay } from "./period";

export type ServiceAccount = { client_email: string; private_key: string; token_uri: string };

const TOKEN_URI = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const DATA_API = "https://analyticsdata.googleapis.com/v1beta";

/** The key file as pasted in the environment: JSON, or JSON in base64. Null when unusable. */
export function parseServiceAccount(raw: string | undefined | null): ServiceAccount | null {
  if (!raw) return null;
  const text = raw.trim();
  const candidates = [text];
  if (!text.startsWith("{")) {
    try {
      candidates.push(Buffer.from(text, "base64").toString("utf8"));
    } catch {
      /* not base64 */
    }
  }
  for (const c of candidates) {
    try {
      const j = JSON.parse(c) as Record<string, unknown>;
      const email = typeof j.client_email === "string" ? j.client_email : "";
      const key = typeof j.private_key === "string" ? j.private_key.replace(/\\n/g, "\n") : "";
      if (email.includes("@") && key.includes("PRIVATE KEY")) {
        return { client_email: email, private_key: key, token_uri: typeof j.token_uri === "string" ? j.token_uri : TOKEN_URI };
      }
    } catch {
      /* next candidate */
    }
  }
  return null;
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

/** The JWT's claims for a token good for `ttlSeconds`. */
export function jwtClaims(account: Pick<ServiceAccount, "client_email" | "token_uri">, nowMs: number, ttlSeconds = 3600) {
  const iat = Math.floor(nowMs / 1000);
  return { iss: account.client_email, scope: SCOPE, aud: account.token_uri || TOKEN_URI, iat, exp: iat + ttlSeconds };
}

/** header.payload.signature, RS256. */
export function signJwt(account: ServiceAccount, nowMs = Date.now()): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify(jwtClaims(account, nowMs)));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(account.private_key).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

type Fetch = typeof fetch;

let tokenCache: { token: string; expiresAt: number; email: string } | null = null;

/** An access token, reused until a minute before it expires. */
export async function accessToken(account: ServiceAccount, fetchImpl: Fetch = fetch, nowMs = Date.now()): Promise<string> {
  if (tokenCache && tokenCache.email === account.client_email && tokenCache.expiresAt - 60_000 > nowMs) return tokenCache.token;
  const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: signJwt(account, nowMs) });
  const res = await fetchImpl(account.token_uri || TOKEN_URI, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !j.access_token) throw new Error(`google_token: ${j.error_description ?? j.error ?? res.status}`);
  tokenCache = { token: j.access_token, expiresAt: nowMs + (j.expires_in ?? 3600) * 1000, email: account.client_email };
  return j.access_token;
}

export function forgetToken(): void {
  tokenCache = null;
}

// ── Reports ──────────────────────────────────────────────────────────────────

export type ReportRequest = {
  dateRanges: { startDate: string; endDate: string; name?: string }[];
  dimensions?: { name: string }[];
  metrics: { name: string }[];
  dimensionFilter?: unknown;
  orderBys?: unknown[];
  limit?: number;
  keepEmptyRows?: boolean;
};

export type ReportResponse = {
  dimensionHeaders?: { name: string }[];
  metricHeaders?: { name: string; type?: string }[];
  rows?: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }[];
  rowCount?: number;
  totals?: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }[];
};

/** `properties/{id}:runReport`, the response as Google sends it. */
export async function runReport(propertyId: string, token: string, body: ReportRequest, fetchImpl: Fetch = fetch): Promise<ReportResponse> {
  const res = await fetchImpl(`${DATA_API}/properties/${encodeURIComponent(propertyId)}:runReport`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await res.json().catch(() => ({}))) as ReportResponse & { error?: { message?: string; status?: string } };
  if (!res.ok) throw new Error(`google_report: ${j.error?.message ?? j.error?.status ?? res.status}`);
  return j;
}

export type ShapedRow = { dims: string[]; metrics: number[] };

/** Rows as plain arrays: dimension strings and metric numbers, in the request's order. */
export function shapeReport(r: ReportResponse): ShapedRow[] {
  return (r.rows ?? []).map((row) => ({
    dims: (row.dimensionValues ?? []).map((d) => d.value ?? ""),
    metrics: (row.metricValues ?? []).map((m) => Number(m.value) || 0),
  }));
}

export type Ga4Totals = { users: number; newUsers: number; sessions: number; pageViews: number; engagedSessions: number; avgSessionSeconds: number };

export type Ga4Data = {
  fetchedAt: string;
  totals: Ga4Totals;
  previous: Ga4Totals;
  daily: { day: string; users: number; sessions: number; pageViews: number }[];
  topPages: { path: string; views: number; users: number }[];
  sources: { source: string; medium: string; sessions: number; users: number }[];
  devices: { device: string; users: number; sessions: number }[];
  countries: { country: string; users: number }[];
  cities: { city: string; users: number }[];
  languages: { language: string; users: number }[];
  landingPages: { path: string; sessions: number }[];
  searchTerms: { term: string; count: number }[];
  /** The sections Google refused, with its words. */
  errors: Record<string, string>;
};

const TOTAL_METRICS = ["totalUsers", "newUsers", "sessions", "screenPageViews", "engagedSessions", "averageSessionDuration"];

function totalsOf(rows: ShapedRow[]): Ga4Totals {
  const m = rows[0]?.metrics ?? [];
  return { users: m[0] ?? 0, newUsers: m[1] ?? 0, sessions: m[2] ?? 0, pageViews: m[3] ?? 0, engagedSessions: m[4] ?? 0, avgSessionSeconds: Math.round(m[5] ?? 0) };
}

/** "2026-11-01" for Google's date ranges: the owner's days, in Tunis (the period's bounds are Tunis midnights). */
const day = (d: Date) => tunisDay(d);

/** Runs tasks a few at a time: the Data API allows ten concurrent reports per property. */
export async function inBatches<T>(tasks: readonly (() => Promise<T>)[], size: number): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < tasks.length; i += size) out.push(...(await Promise.all(tasks.slice(i, i + size).map((t) => t()))));
  return out;
}

/**
 * Every report the Traffic section shows, in parallel; a section Google
 * refuses (a custom dimension not registered, a quota) comes back empty with
 * the reason in `errors`, the others still show.
 */
export async function fetchGa4Data(
  input: { propertyId: string; account: ServiceAccount; from: Date; to: Date; prevFrom: Date; prevTo: Date; limit?: number },
  fetchImpl: Fetch = fetch,
): Promise<Ga4Data> {
  const token = await accessToken(input.account, fetchImpl);
  const limit = input.limit ?? 10;
  const cur = { startDate: day(input.from), endDate: day(new Date(input.to.getTime() - 1)) };
  const prev = { startDate: day(input.prevFrom), endDate: day(new Date(input.prevTo.getTime() - 1)) };
  const errors: Record<string, string> = {};
  const report = async (key: string, body: ReportRequest): Promise<ShapedRow[]> => {
    try {
      return shapeReport(await runReport(input.propertyId, token, body, fetchImpl));
    } catch (e) {
      errors[key] = e instanceof Error ? e.message : String(e);
      return [];
    }
  };
  const metrics = (names: string[]) => names.map((name) => ({ name }));
  const dims = (names: string[]) => names.map((name) => ({ name }));
  const byMetricDesc = (name: string) => [{ metric: { metricName: name }, desc: true }];

  // Four at a time: Google allows ten concurrent reports per property, and a
  // 429 would be cached for the whole TTL.
  const [totals, previous, daily, topPages, sources, devices, countries, cities, languages, landingPages, searchTerms] = await inBatches([
    () => report("totals", { dateRanges: [cur], metrics: metrics(TOTAL_METRICS) }),
    () => report("previous", { dateRanges: [prev], metrics: metrics(TOTAL_METRICS) }),
    () => report("daily", { dateRanges: [cur], dimensions: dims(["date"]), metrics: metrics(["totalUsers", "sessions", "screenPageViews"]), orderBys: [{ dimension: { dimensionName: "date" } }], limit: 400 }),
    () => report("topPages", { dateRanges: [cur], dimensions: dims(["pagePath"]), metrics: metrics(["screenPageViews", "totalUsers"]), orderBys: byMetricDesc("screenPageViews"), limit }),
    () => report("sources", { dateRanges: [cur], dimensions: dims(["sessionSource", "sessionMedium"]), metrics: metrics(["sessions", "totalUsers"]), orderBys: byMetricDesc("sessions"), limit }),
    () => report("devices", { dateRanges: [cur], dimensions: dims(["deviceCategory"]), metrics: metrics(["totalUsers", "sessions"]), orderBys: byMetricDesc("totalUsers"), limit: 5 }),
    () => report("countries", { dateRanges: [cur], dimensions: dims(["country"]), metrics: metrics(["totalUsers"]), orderBys: byMetricDesc("totalUsers"), limit }),
    () => report("cities", { dateRanges: [cur], dimensions: dims(["city"]), metrics: metrics(["totalUsers"]), orderBys: byMetricDesc("totalUsers"), limit }),
    () => report("languages", { dateRanges: [cur], dimensions: dims(["language"]), metrics: metrics(["totalUsers"]), orderBys: byMetricDesc("totalUsers"), limit }),
    () => report("landingPages", { dateRanges: [cur], dimensions: dims(["landingPage"]), metrics: metrics(["sessions"]), orderBys: byMetricDesc("sessions"), limit }),
    () => report("searchTerms", {
      dateRanges: [cur],
      dimensions: dims(["customEvent:search_term"]),
      metrics: metrics(["eventCount"]),
      dimensionFilter: { filter: { fieldName: "eventName", stringFilter: { matchType: "EXACT", value: "search" } } },
      orderBys: byMetricDesc("eventCount"),
      limit,
    }),
  ], 4);

  const ymd = (s: string) => (s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s);
  return {
    fetchedAt: new Date().toISOString(),
    totals: totalsOf(totals),
    previous: totalsOf(previous),
    daily: daily.map((r) => ({ day: ymd(r.dims[0] ?? ""), users: r.metrics[0] ?? 0, sessions: r.metrics[1] ?? 0, pageViews: r.metrics[2] ?? 0 })),
    topPages: topPages.map((r) => ({ path: r.dims[0] ?? "", views: r.metrics[0] ?? 0, users: r.metrics[1] ?? 0 })),
    sources: sources.map((r) => ({ source: r.dims[0] ?? "", medium: r.dims[1] ?? "", sessions: r.metrics[0] ?? 0, users: r.metrics[1] ?? 0 })),
    devices: devices.map((r) => ({ device: r.dims[0] ?? "", users: r.metrics[0] ?? 0, sessions: r.metrics[1] ?? 0 })),
    countries: countries.map((r) => ({ country: r.dims[0] ?? "", users: r.metrics[0] ?? 0 })),
    cities: cities.map((r) => ({ city: r.dims[0] ?? "", users: r.metrics[0] ?? 0 })),
    languages: languages.map((r) => ({ language: r.dims[0] ?? "", users: r.metrics[0] ?? 0 })),
    landingPages: landingPages.map((r) => ({ path: r.dims[0] ?? "", sessions: r.metrics[0] ?? 0 })),
    searchTerms: searchTerms.filter((r) => (r.dims[0] ?? "") !== "(not set)").map((r) => ({ term: r.dims[0] ?? "", count: r.metrics[0] ?? 0 })),
    errors,
  };
}

/** One small report, to say whether the connection works: the property's users over the last week. */
export async function testGa4(propertyId: string, account: ServiceAccount, fetchImpl: Fetch = fetch): Promise<{ ok: true; users: number } | { ok: false; error: string }> {
  try {
    const token = await accessToken(account, fetchImpl);
    const r = await runReport(propertyId, token, { dateRanges: [{ startDate: "7daysAgo", endDate: "today" }], metrics: [{ name: "totalUsers" }] }, fetchImpl);
    return { ok: true, users: shapeReport(r)[0]?.metrics[0] ?? 0 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
