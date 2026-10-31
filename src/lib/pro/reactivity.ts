import type { getServiceSupabase } from "@/lib/supabase/admin";

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

/**
 * « Agence réactive »: the badge an agence earns by answering its visit
 * requests fast (the owner, 2026-10-31, after Property Finder's SuperAgent
 * and Bayut's TruBroker). Nobody gives it and nobody can buy it: it is read
 * from what the agence did with the requests buyers sent it — confirmed or
 * declined, how long after.
 *
 * Over the last `days` days, of the requests that can be judged, at least
 * `minRate` percent got their answer within `hours` hours, and there are at
 * least `minRequests` of them (a badge from one lucky answer says nothing).
 * A request still waiting inside its `hours` is not judged yet; one left
 * unanswered past it counts against the agence. A request the buyer cancelled
 * is not the agence's.
 */
export type ReactiveRules = { hours: number; days: number; minRequests: number; minRate: number };

export type Reactivity = {
  /** The requests judged: answered, or left waiting past the delay. */
  total: number;
  /** Answered within the delay. */
  fast: number;
  /** fast / total in percent, null with nothing judged. */
  rate: number | null;
  reactive: boolean;
  rules: ReactiveRules;
};

export type RequestRow = { status: string; created_at: string; decided_at: string | null };

const HOUR = 3_600_000;

export function computeReactivity(rows: readonly RequestRow[], rules: ReactiveRules, now: Date = new Date()): Reactivity {
  const since = now.getTime() - rules.days * 24 * HOUR;
  const delay = rules.hours * HOUR;
  let total = 0;
  let fast = 0;
  for (const r of rows) {
    if (r.status === "cancelled") continue;
    const created = new Date(r.created_at).getTime();
    if (!Number.isFinite(created) || created < since) continue;
    const decided = r.decided_at ? new Date(r.decided_at).getTime() : null;
    if (decided !== null && Number.isFinite(decided)) {
      total += 1;
      if (decided - created <= delay) fast += 1;
    } else if (now.getTime() - created > delay) {
      // Left waiting past the delay: judged, and not fast.
      total += 1;
    }
  }
  const rate = total > 0 ? Math.round((fast / total) * 100) : null;
  return { total, fast, rate, reactive: total >= rules.minRequests && rate !== null && rate >= rules.minRate, rules };
}

/** The rules the settings give. */
export function reactiveRules(s: { reactive_hours: number; reactive_days: number; reactive_min_requests: number; reactive_min_rate: number }): ReactiveRules {
  return { hours: s.reactive_hours, days: s.reactive_days, minRequests: s.reactive_min_requests, minRate: s.reactive_min_rate };
}

/** The reactivity of several agences at once: one query for their requests of the period. */
export async function loadReactivity(admin: Admin, shopIds: readonly string[], rules: ReactiveRules, now: Date = new Date()): Promise<Map<string, Reactivity>> {
  const out = new Map<string, Reactivity>();
  if (shopIds.length === 0) return out;
  const since = new Date(now.getTime() - rules.days * 24 * HOUR).toISOString();
  // A badge is a nicety: any failure leaves the pages without it.
  try {
    const { data } = await admin
      .from("visit_requests")
      .select("shop_id, status, created_at, decided_at")
      .in("shop_id", [...shopIds])
      .neq("status", "cancelled")
      .gte("created_at", since)
      .limit(5000);
    const byShop = new Map<string, RequestRow[]>();
    for (const r of (data ?? []) as (RequestRow & { shop_id: string })[]) {
      const list = byShop.get(r.shop_id) ?? [];
      list.push(r);
      byShop.set(r.shop_id, list);
    }
    for (const id of shopIds) out.set(id, computeReactivity(byShop.get(id) ?? [], rules, now));
  } catch {
    /* no badge */
  }
  return out;
}

/** The reactive ones first, each group keeping the order it came in (the strip's daily turn). */
export function reactiveFirst<T extends { id: string }>(rows: readonly T[], reactive: ReadonlySet<string>): T[] {
  return [...rows.filter((r) => reactive.has(r.id)), ...rows.filter((r) => !reactive.has(r.id))];
}
