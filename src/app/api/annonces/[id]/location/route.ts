import { NextRequest, NextResponse } from "next/server";
import { jsonObject } from "@/lib/http/body";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { suspendedResponse } from "@/lib/moderation/ban";
import { featureOff } from "@/lib/settings/gate";
import { getSettings } from "@/lib/settings/server";
import { asPin } from "@/lib/geo/location";
import { pinUpdate } from "@/lib/geo/server";
import { proposeEdit } from "@/lib/listings/edit";

/**
 * PUT /api/annonces/[id]/location — the seller puts, moves or takes away the
 * pin of an annonce of theirs (0212), at any stage: « Ajouter la position »
 * on an annonce already online is what fills the map.
 *
 *   { lat, lng, exact }   the pin, and whether visitors see it or a circle
 *   { clear: true }       no place on the map any more
 *
 * On an annonce online, a pin changes no word, price or photo the moderation
 * read, so it goes live at once — unless the console says otherwise
 * (map_pin_live_without_review), and then it waits for an admin like any edit.
 */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  const off = await featureOff("feature_listing_map");
  if (off) return off;
  const { id } = await ctx.params;

  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  const banned = await suspendedResponse(admin, req, user.id);
  if (banned) return banned;

  const { data: listing } = await admin
    .from("listings")
    .select("id, seller_id, status, pin_lat, pin_lng, location_exact")
    .eq("id", id)
    .maybeSingle();
  if (!listing) return NextResponse.json({ error: "listing_not_found" }, { status: 404 });
  if (listing.seller_id !== user.id) return NextResponse.json({ error: "not_owner" }, { status: 403 });

  const body = await jsonObject(req);
  const clear = body.clear === true;
  const pin = clear ? null : asPin(body);
  if (!clear && !pin) {
    const t = await apiTranslator(req, "listingMap.api");
    return NextResponse.json({ error: "bad_location", detail: t("badLocation") }, { status: 400 });
  }
  const exact = !clear && body.exact === true;

  const settings = await getSettings();
  const columns = pinUpdate(listing, pin, exact, settings.map_approx_radius_m);
  if (!columns) return NextResponse.json({ ok: true, status: listing.status, changed: false });

  if (listing.status === "published" && !settings.map_pin_live_without_review) {
    const out = await proposeEdit(admin, id, { fields: columns, photos: null });
    if (out.status === "error") return fail("listing_location_failed", 500, out.error);
    logAction(req, user, "listing.location", { id, exact, cleared: clear, review: true });
    return NextResponse.json({ ok: true, status: "pending_review", changed: true });
  }

  const { error } = await admin.from("listings").update(columns).eq("id", id);
  if (error) return fail("listing_location_failed", 500, error);
  logAction(req, user, "listing.location", { id, exact, cleared: clear });
  return NextResponse.json({ ok: true, status: listing.status, changed: true });
}
