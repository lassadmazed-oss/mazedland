import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { featureOff } from "@/lib/settings/gate";
import { getSettings } from "@/lib/settings/server";
import { fail } from "@/lib/http/errors";
import { jsonObject } from "@/lib/http/body";
import { loadLead, mintPhotoUrls } from "@/lib/prospection/server";

/**
 * POST /api/admin/prospection/leads/:id/photo-url  { exts: string[] }
 *   → { uploads: [{ path, signedUrl }] }
 *
 * The same signed upload URLs as the publish form's (/api/annonces/photo-url),
 * minted into the OWNER's folder — their annonce is theirs — once they said
 * yes. The path is chosen here, never by the browser.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req, "prospection");
  if (gate instanceof NextResponse) return gate;
  const off = await featureOff("feature_prospection");
  if (off) return off;
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  const { id } = await params;

  const lead = await loadLead(admin, id);
  if (!lead) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (lead.status !== "confirmed" || !lead.seller_id || !lead.listing_id) {
    return NextResponse.json({ error: "wrong_step" }, { status: 409 });
  }

  const { data: over } = await admin.rpc("check_rate_limit", {
    p_key: `prospect-photo:${gate.user.id}`,
    p_max: 240,
    p_window_secs: 3600,
  });
  if (over === true) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const body = await jsonObject(req);
  const { listing_max_photos } = await getSettings();
  const exts = (Array.isArray(body.exts) ? body.exts : []).map((e) => String(e ?? "")).slice(0, listing_max_photos);
  if (exts.length === 0) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const uploads = await mintPhotoUrls(admin, lead.seller_id, exts);
  if (!uploads) return NextResponse.json({ error: "signed_url_failed" }, { status: 500 });
  return NextResponse.json({ uploads });
}
