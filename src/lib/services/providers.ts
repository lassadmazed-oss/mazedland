/**
 * What each provider says about a service, read by the hourly run
 * (/api/cron/services) into `paid_services.auto_*`.
 *
 *   vercel     GET /v2/teams/<id> with VERCEL_TOKEN: the billing period's end,
 *              the plan's status and the soft block (« UNPAID_INVOICE » on
 *              2026-11-01, the day both sites answered 402).
 *   rdap       the domain's public registration record: its expiry, and a
 *              hold that takes the site off the net.
 *   winsms     the SMS credit left and the licence's end.
 *   anthropic  no billing API for a plain key: the site's own AI calls say it —
 *              « credit balance too low » on the last one is an unpaid credit.
 *   supabase   no billing API without a personal token: the run reading this
 *              very table is the proof the database answers.
 *
 * The parsers are pure (and tested); the readers only fetch.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkBalance } from "@/lib/winsms";
import { tunisDay } from "@/lib/visits";
import type { AutoSource, AutoStatus, PaidService } from "./services";

export type Reading = {
  status: AutoStatus;
  detail: Record<string, unknown>;
  /** The provider's date, when it has one; a reading without it keeps the stored date. */
  renewsOn?: string;
  /** What the provider bills, in USD, when it says. */
  costUsd?: number;
};

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const ms = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v ? Date.parse(v) || null : null);
const iso = (v: unknown): string | null => {
  const t = ms(v);
  return t === null ? null : new Date(t).toISOString();
};

/** Vercel's plan states that mean it is paid and running. */
const VERCEL_FINE = new Set(["active", "trialing"]);

export function parseVercelTeam(body: unknown): Reading {
  const team = obj(body);
  const billing = obj(team.billing);
  const period = obj(billing.period);
  const block = team.softBlock ? obj(team.softBlock) : null;
  const status = typeof billing.status === "string" ? billing.status : null;
  const end = ms(period.end);
  const pro = obj(obj(billing.invoiceItems).pro);
  return {
    status: block ? "blocked" : status && !VERCEL_FINE.has(status) ? "unpaid" : "ok",
    detail: {
      plan: typeof billing.plan === "string" ? billing.plan : null,
      status,
      block: block ? (typeof block.reason === "string" ? block.reason : "blocked") : null,
      blockedAt: block ? iso(block.blockedAt) : null,
      periodEnd: end === null ? null : new Date(end).toISOString(),
    },
    ...(end === null ? {} : { renewsOn: tunisDay(new Date(end)) }),
    // Cents: 2000 is the 20 USD of the Pro seat.
    ...(typeof pro.price === "number" && pro.price > 0 ? { costUsd: pro.price / 100 } : {}),
  };
}

/** EPP statuses that take a domain off the net: a hold, the grace after expiry. */
const DOMAIN_DOWN = /hold|redemption|pending delete/i;

export function parseRdap(body: unknown): Reading {
  const d = obj(body);
  const events = Array.isArray(d.events) ? d.events.map(obj) : [];
  const expiry = events.find((e) => e.eventAction === "expiration")?.eventDate;
  const statuses = Array.isArray(d.status) ? d.status.filter((s): s is string => typeof s === "string") : [];
  const entities = Array.isArray(d.entities) ? d.entities.map(obj) : [];
  const registrarCard = entities.find((e) => Array.isArray(e.roles) && e.roles.includes("registrar"))?.vcardArray;
  const fields = Array.isArray(registrarCard) && Array.isArray(registrarCard[1]) ? (registrarCard[1] as unknown[]) : [];
  const fn = fields.find((f) => Array.isArray(f) && f[0] === "fn") as unknown[] | undefined;
  const at = ms(expiry);
  return {
    status: statuses.some((s) => DOMAIN_DOWN.test(s)) ? "blocked" : "ok",
    detail: {
      registrar: typeof fn?.[3] === "string" ? fn[3] : null,
      statuses,
      expiresAt: at === null ? null : new Date(at).toISOString(),
    },
    ...(at === null ? {} : { renewsOn: tunisDay(new Date(at)) }),
  };
}

export function winsmsReading(r: { balance: number; licence?: string; holder?: string }, lowBalance: number): Reading {
  return {
    status: lowBalance > 0 && r.balance < lowBalance ? "low" : "ok",
    detail: { balance: r.balance, licence: r.licence ?? null, holder: r.holder ?? null },
    ...(r.licence ? { renewsOn: r.licence } : {}),
  };
}

type AiCall = { ok: boolean; error: string | null; cost_usd: number | string | null; created_at: string };

/**
 * The last 30 days of the site's own calls (newest first): what they cost,
 * and whether the most recent answer from Anthropic was « no credit left »
 * (`api_credit`, src/lib/ai/server.ts) with no success since.
 */
export function anthropicReading(calls: AiCall[]): Reading {
  const spend = calls.reduce((sum, c) => sum + (Number(c.cost_usd) || 0), 0);
  const lastCredit = calls.find((c) => c.error === "api_credit");
  const lastOk = calls.find((c) => c.ok);
  const unpaid = Boolean(lastCredit && (!lastOk || lastCredit.created_at > lastOk.created_at));
  return {
    status: unpaid ? "unpaid" : "ok",
    detail: {
      calls30: calls.length,
      spend30: Math.round(spend * 100) / 100,
      noCreditSince: unpaid ? lastCredit!.created_at : null,
    },
  };
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000), cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

type Ctx = { db: SupabaseClient; lowBalance: number };

/** One service's reading; a provider that does not answer throws. */
export async function readProvider(s: Pick<PaidService, "auto_source" | "auto_ref">, ctx: Ctx): Promise<Reading> {
  const source = s.auto_source as AutoSource;
  switch (source) {
    case "vercel": {
      const token = process.env.VERCEL_TOKEN;
      if (!token) throw new Error("VERCEL_TOKEN not set");
      const team = encodeURIComponent(s.auto_ref ?? "");
      return parseVercelTeam(await fetchJson(`https://api.vercel.com/v2/teams/${team}`, { headers: { Authorization: `Bearer ${token}` } }));
    }
    case "rdap": {
      const domain = encodeURIComponent((s.auto_ref ?? "").toLowerCase());
      return parseRdap(await fetchJson(`https://rdap.org/domain/${domain}`, { headers: { Accept: "application/rdap+json" } }));
    }
    case "winsms": {
      const r = await checkBalance();
      if (!r.ok) throw new Error(r.error);
      return winsmsReading(r, ctx.lowBalance);
    }
    case "anthropic": {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const { data, error } = await ctx.db
        .from("ai_calls")
        .select("ok, error, cost_usd, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw new Error(error.message);
      return anthropicReading((data ?? []) as AiCall[]);
    }
    case "supabase":
      return { status: "ok", detail: { answers: true } };
  }
}

/**
 * Whether Supabase answers at all, asked without the database: the auth
 * health endpoint. The hourly run asks it when its own queries failed, before
 * telling the owner the database is down rather than reporting a bug.
 */
export async function supabaseAnswers(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return true;
  try {
    const res = await fetch(`${url}/auth/v1/health`, { headers: { apikey: key }, signal: AbortSignal.timeout(10_000), cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}
