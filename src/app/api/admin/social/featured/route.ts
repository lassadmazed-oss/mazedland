import { NextRequest, NextResponse } from "next/server";
import { jsonObject } from "@/lib/http/body";
import { requireAdmin } from "@/lib/admin/guard";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { isSocialChannel, isSocialLanguage } from "@/lib/social/channels";
import { createFeaturedRequest } from "@/lib/social/server";

/**
 * POST /api/admin/social/featured — an admin puts an annonce forward on
 * Mazed's pages (0214), from the annonce itself.
 *
 *   { listingId, channels: ["facebook_mazed" | "facebook_page" | "instagram" | "facebook_groups"],
 *     language: "both" | "ar" | "fr" }
 *
 * The texts are generated now and the ask waits in « À valider », where the
 * admin reads them before anything is posted. Refused with seller_terms
 * while the seller has not accepted the CGU that allow it.
 */
export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, "social");
  if (gate instanceof NextResponse) return gate;
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const body = await jsonObject(req);
  const listingId = typeof body.listingId === "string" ? body.listingId : "";
  const channels = Array.isArray(body.channels) ? body.channels.filter(isSocialChannel) : [];
  const language = isSocialLanguage(body.language) ? body.language : "both";

  const result = await createFeaturedRequest(admin, {
    adminId: gate.user.id,
    listingId,
    channels,
    language,
    origin: req.nextUrl.origin,
  });
  if (!result.ok) {
    const status = result.error === "db" ? 500 : result.error === "not_found" ? 404 : result.error === "already_open" ? 409 : 400;
    return NextResponse.json(result, { status });
  }
  logAction(req, gate.user, "social.feature", { id: result.id, listingId, channels });
  return NextResponse.json(result);
}
