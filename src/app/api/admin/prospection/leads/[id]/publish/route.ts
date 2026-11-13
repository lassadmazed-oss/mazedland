import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { featureOff } from "@/lib/settings/gate";
import { fail } from "@/lib/http/errors";
import { jsonObject } from "@/lib/http/body";
import { logAction } from "@/lib/activity";
import { publishLead } from "@/lib/prospection/server";

/**
 * POST /api/admin/prospection/leads/:id/publish  { photosChecked: true }
 *
 * « Publier »: the annonce of a lead that said yes goes through a free place
 * and the moderation rules (src/lib/prospection/server.ts publishLead). It
 * needs the site's minimum of photos, and the member's word that they looked
 * at each one — no phone number written on it, no other agency's mark. When
 * it is online the owner gets the SMS with their private link.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req, "prospection");
  if (gate instanceof NextResponse) return gate;
  const off = await featureOff("feature_prospection");
  if (off) return off;
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  const { id } = await params;

  const body = await jsonObject(req);
  const out = await publishLead(admin, {
    leadId: id,
    actorId: gate.user.id,
    photosChecked: body.photosChecked === true,
    origin: req.nextUrl.origin,
  });
  if (!out.ok) {
    const status = out.error === "not_found" ? 404 : out.error === "failed" ? 500 : out.error === "free_limit_reached" ? 402 : 409;
    return NextResponse.json({ error: out.error, blockers: out.blockers, fields: out.fields }, { status });
  }
  logAction(req, gate.user, "prospect.publish", { id, outcome: out.outcome });
  return NextResponse.json({ ok: true, outcome: out.outcome, sms: out.sms });
}
