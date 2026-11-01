import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { clientIp } from "@/lib/clientIp";
import { getSettings } from "@/lib/settings/server";
import { isSupabaseAuthCookie } from "@/lib/supabase/session-cookie";
import { tunisDay } from "@/lib/analytics/period";
import { dailyVisitorKey, deviceOf, insertEventRows, readBatch, rowsFromBatch } from "@/lib/analytics/server-events";

/**
 * POST /api/events — a browser's batch of the site's own analytics events
 * (src/lib/analytics/events.ts), written to site_events (0204).
 *
 * Same origin only, like every beacon. Off when the admin switched the count
 * off (analytics_events_enabled). One browser may send a bounded number of
 * events an hour (analytics_events_per_hour, counted event by event through
 * check_rate_limit_n): a reader opens a few dozen annonces in an evening,
 * thousands an hour is a script. The cap is per address AND browser, so an
 * office or a mobile network behind one address is not one visitor. A
 * crawler's batch is dropped. Whatever happens, the answer is 204: a count
 * lost is not the visitor's problem, and nothing here is worth a message on
 * screen.
 *
 * Who sent it: the signed-in account when there is a session cookie (one
 * auth round trip per batch, not per event), else a key made of the address
 * and the browser, salted and hashed, that changes every day (Tunis) — or
 * the random id a visitor who accepted analytics carries (`cid`).
 */
const ok = () => new NextResponse(null, { status: 204 });

// The category slugs the events may name, read once every ten minutes.
let categoryCache: { at: number; slugs: Set<string> } | null = null;
async function categorySlugs(admin: SupabaseClient): Promise<Set<string>> {
  if (categoryCache && Date.now() - categoryCache.at < 600_000) return categoryCache.slugs;
  const { data } = await admin.from("categories").select("slug");
  const slugs = new Set(((data ?? []) as { slug: string }[]).map((c) => c.slug));
  if (slugs.size > 0) categoryCache = { at: Date.now(), slugs };
  return slugs;
}

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });

  const admin = getServiceSupabase();
  if (!admin) return ok();
  const settings = await getSettings();
  if (!settings.analytics_events_enabled) return ok();

  const ua = req.headers.get("user-agent");
  const device = deviceOf(ua);
  if (device === "bot") return ok();

  const { cid, events } = readBatch(await req.json().catch(() => null));
  if (events.length === 0) return ok();

  const ip = clientIp(req) || "unknown";
  const salt = process.env.CRON_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "mazed";
  const day = tunisDay(new Date());
  const anonKey = dailyVisitorKey(ip, ua, day, salt);
  const { data: over } = await admin.rpc("check_rate_limit_n", {
    p_key: `events:${anonKey}`,
    p_max: settings.analytics_events_per_hour,
    p_window_secs: 3600,
    p_n: events.length,
  });
  if (over === true) return ok();

  let userId: string | null = null;
  if (req.cookies.getAll().some((c) => isSupabaseAuthCookie(c.name))) {
    try {
      const supabase = await getServerSupabase();
      const { data } = await supabase.auth.getUser();
      userId = data.user?.id ?? null;
    } catch {
      userId = null;
    }
  }
  const visitorKey = userId ? `u:${userId}` : cid ? `c:${cid}` : anonKey;
  const categories = events.some((e) => "cat" in e.p) ? await categorySlugs(admin) : undefined;

  await insertEventRows(rowsFromBatch(events, { userId, visitorKey, device, now: Date.now(), categories }));
  return ok();
}
