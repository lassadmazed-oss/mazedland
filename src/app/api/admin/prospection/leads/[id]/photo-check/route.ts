import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { featureOff } from "@/lib/settings/gate";
import { fail } from "@/lib/http/errors";
import { logAction } from "@/lib/activity";
import { loadLead } from "@/lib/prospection/server";
import { checkLeadPhotos } from "@/lib/prospection/photoCheck.server";

/**
 * POST /api/admin/prospection/leads/:id/photo-check
 *
 * « Vérifier les photos »: what each photo of the lead's annonce shows and
 * what a person would object to (a phone number on it, another agency's mark, a
 * face, a screenshot, a poor picture), whether it is already on another annonce
 * of the site, and the order that puts the best cover first
 * (src/lib/prospection/photoCheck.server.ts). It reads and suggests; it changes
 * nothing. Thirty a member and hour: each one costs a model call.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req, "prospection");
  if (gate instanceof NextResponse) return gate;
  const off = (await featureOff("feature_prospection")) ?? (await featureOff("feature_prospect_photo_check"));
  if (off) return off;
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  const { id } = await params;

  const lead = await loadLead(admin, id);
  if (!lead) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (lead.status !== "confirmed" || !lead.listing_id) return NextResponse.json({ error: "wrong_step" }, { status: 409 });

  const { data: over } = await admin.rpc("check_rate_limit", {
    p_key: `prospect-photocheck:${gate.user.id}`,
    p_max: 30,
    p_window_secs: 3600,
  });
  if (over === true) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const out = await checkLeadPhotos(admin, { lead, actorId: gate.user.id });
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.error === "no_photos" ? 409 : 422 });
  logAction(req, gate.user, "prospect.photo_check", { id, photos: out.result.photos.length, ai: out.result.ai });
  return NextResponse.json({ ok: true, ...out.result });
}
