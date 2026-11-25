import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron/auth";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { loadSettings } from "@/lib/settings/server";
import { siteUrl } from "@/lib/siteUrl";
import { routing } from "@/i18n/routing";
import { annonceUrls, INDEXNOW_STATUSES, submitIndexNow } from "@/lib/indexnow";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Hourly (vercel.json): every annonce whose row changed in the last 70 minutes
 * — put online, edited, sold, rented, expired, taken down — sent to IndexNow
 * in both languages (src/lib/indexnow.ts), so Bing and the engines that share
 * its feed come back for it now rather than in days. A gone annonce is sent
 * too: the engine reads its « no longer here » and drops it.
 *
 * Auth: CRON_SECRET as a Bearer header, which Vercel's cron sends.
 */
async function run(req: NextRequest) {
  const denied = verifyCronSecret(req);
  if (denied) return denied;
  const db = getServiceSupabase();
  if (!db) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  const settings = await loadSettings(db);
  if (!settings.seo_indexnow_enabled || !settings.seo_indexnow_key) return NextResponse.json({ ok: true, skipped: "off" });
  const origin = siteUrl() ?? "https://www.mazed.immo";
  const since = new Date(Date.now() - 70 * 60_000).toISOString();
  const { data, error } = await db
    .from("listings")
    .select("id")
    .gte("updated_at", since)
    .in("status", [...INDEXNOW_STATUSES])
    .limit(4000);
  if (error) {
    log.scope("indexnow").error("query failed", { msg: error.message });
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  const urls = annonceUrls(origin, ids, routing.locales);
  const status = await submitIndexNow(origin, settings.seo_indexnow_key, urls);
  return NextResponse.json({ ok: true, annonces: ids.length, urls: urls.length, status });
}

export const GET = run;
export const POST = run;
