import { readSetting } from "@/lib/settings/define";
import { SETTINGS } from "@/lib/settings/registry";
import { timeoutSignal } from "@/lib/timeoutSignal";
import type { LimitedCrawler } from "@/lib/crawlers";

/**
 * A limited crawler's daily budget (src/lib/crawlers.ts), read and counted for
 * the proxy, which has no service client of its own: two small REST calls, for
 * these crawlers' requests only. The setting is kept five minutes per server
 * instance. A failure lets the request through: the budget is a brake, not a
 * lock, and the page itself is cheap next to the old 43 000 visits a day.
 */
const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { value: number; at: number }>();

function rest(path: string, init?: RequestInit): Promise<Response> | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", ...(init?.headers ?? {}) },
    signal: timeoutSignal(1500),
    cache: "no-store",
  });
}

/** Today's budget of this crawler, from the console (0 = door closed). */
export async function crawlerBudget(c: LimitedCrawler): Promise<number> {
  const def = SETTINGS[c.budget];
  const hit = cache.get(c.budget);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  let value = readSetting(def, undefined) as number;
  try {
    const res = await rest(`app_settings?key=eq.${c.budget}&select=value`);
    if (res?.ok) {
      const rows = (await res.json()) as { value: unknown }[];
      if (rows[0]) value = readSetting(def, rows[0].value) as number;
    }
  } catch {
    /* the default stands */
  }
  cache.set(c.budget, { value, at: Date.now() });
  return value;
}

/** True when the last 24 hours already hold the budget (the hit is counted otherwise); null when it could not be asked. */
export async function crawlerOverBudget(c: LimitedCrawler, budget: number): Promise<boolean | null> {
  try {
    const res = await rest("rpc/check_rate_limit", {
      method: "POST",
      body: JSON.stringify({ p_key: `crawler:${c.name}`, p_max: budget, p_window_secs: 86_400 }),
    });
    if (!res?.ok) return null;
    return (await res.json()) === true;
  } catch {
    return null;
  }
}
