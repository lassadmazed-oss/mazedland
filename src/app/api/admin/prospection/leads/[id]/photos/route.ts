import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { featureOff } from "@/lib/settings/gate";
import { getSettings } from "@/lib/settings/server";
import { fail } from "@/lib/http/errors";
import { jsonObject } from "@/lib/http/body";
import { ensurePhotoSizes } from "@/lib/photoSizes.server";
import { loadLead, savePhotos } from "@/lib/prospection/server";

/**
 * PUT /api/admin/prospection/leads/:id/photos  { paths: string[] }
 *
 * The gallery of the owner's annonce, in order, from the paths the uploader
 * got back (photo-url). Only paths in the owner's own folder, shaped like the
 * publish form's, are kept; the smaller sizes are made after the answer.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req, "prospection");
  if (gate instanceof NextResponse) return gate;
  const off = await featureOff("feature_prospection");
  if (off) return off;
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  const { id } = await params;

  const lead = await loadLead(admin, id);
  if (!lead) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (lead.status !== "confirmed") return NextResponse.json({ error: "wrong_step" }, { status: 409 });

  const body = await jsonObject(req);
  const { listing_max_photos } = await getSettings();
  const saved = await savePhotos(admin, lead, body.paths, listing_max_photos);
  if (!saved.ok) return saved.error === "not_confirmed" ? NextResponse.json({ error: "wrong_step" }, { status: 409 }) : fail("photos_save_failed", 500);

  if (saved.paths.length > 0) after(() => ensurePhotoSizes(admin, saved.paths).then(() => {}));
  return NextResponse.json({ ok: true, count: saved.paths.length });
}
