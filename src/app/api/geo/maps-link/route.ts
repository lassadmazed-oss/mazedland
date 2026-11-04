import { NextRequest, NextResponse } from "next/server";
import { jsonObject } from "@/lib/http/body";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { featureOff } from "@/lib/settings/gate";
import { resolveMapsLink } from "@/lib/geo/server";
import { log } from "@/lib/log";

const gLog = log.scope("maps-link");

/**
 * POST /api/geo/maps-link { url } → { lat, lng } — the point a Google Maps
 * link names, for the pin in the publish form. A long link is read in the
 * browser already; this is for the short ones (maps.app.goo.gl), which only
 * say where they lead once followed (src/lib/geo/server.ts: Google's hosts
 * only). For signed-in sellers, and a few times an hour each.
 */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  const off = await featureOff("feature_listing_map");
  if (off) return off;

  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  const { data: over } = await admin.rpc("check_rate_limit", { p_key: `maps-link:${user.id}`, p_max: 30, p_window_secs: 3600 });
  if (over === true) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const body = await jsonObject(req);
  const url = typeof body.url === "string" ? body.url.trim().slice(0, 2000) : "";
  const t = await apiTranslator(req, "listingMap.api");

  let point: Awaited<ReturnType<typeof resolveMapsLink>> = null;
  try {
    point = await resolveMapsLink(url);
  } catch (e) {
    gLog.warn(`resolve failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!point) return NextResponse.json({ error: "no_point", detail: t("noPoint") }, { status: 422 });
  if (point.outside) return NextResponse.json({ error: "outside", detail: t("outside") }, { status: 422 });
  return NextResponse.json({ lat: point.lat, lng: point.lng });
}
