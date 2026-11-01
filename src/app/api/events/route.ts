import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { clientIp } from "@/lib/clientIp";
import { getSettings } from "@/lib/settings/server";
import { isSupabaseAuthCookie } from "@/lib/supabase/session-cookie";
import { MAX_BATCH } from "@/lib/analytics/events";
import { dailyVisitorKey, deviceOf, insertEventRows, readBatch, rowsFromBatch } from "@/lib/analytics/server-events";

/**
 * POST /api/events — a browser's batch of the site's own analytics events
 * (src/lib/analytics/events.ts), written to site_events (0204).
 *
 * Same origin only, like every beacon. Off when the admin switched the count
 * off (analytics_events_enabled). One browser may send a bounded number of
 * events an hour (analytics_events_per_hour): a reader opens a few dozen
 * annonces in an evening, thousands an hour is a script. A crawler's batch
 * is dropped. Whatever happens, the answer is 204: a count lost is not the
 * visitor's problem, and nothing here is worth a message on screen.
 *
 * Who sent it: the signed-in account when there is a session cookie (one
 * auth round trip per batch, not per event), else a key made of the address
 * and the browser, salted and hashed, that changes every day — or the random
 * id a visitor who accepted analytics carries (`cid`).
 */
const ok = () => new NextResponse(null, { status: 204 });

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
  const day = new Date().toISOString().slice(0, 10);
  // The cap counts batches, not events: a batch holds MAX_BATCH at most.
  const { data: over } = await admin.rpc("check_rate_limit", {
    p_key: `events:${dailyVisitorKey(ip, null, day, salt)}`,
    p_max: Math.max(1, Math.ceil(settings.analytics_events_per_hour / MAX_BATCH)),
    p_window_secs: 3600,
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
  const visitorKey = userId ? `u:${userId}` : cid ? `c:${cid}` : dailyVisitorKey(ip, ua, day, salt);

  await insertEventRows(rowsFromBatch(events, { userId, visitorKey, device, now: Date.now() }));
  return ok();
}
