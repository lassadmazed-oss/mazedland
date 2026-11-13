import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { featureOff } from "@/lib/settings/gate";
import { fail } from "@/lib/http/errors";
import { jsonObject } from "@/lib/http/body";
import { logAction } from "@/lib/activity";
import { isChannel } from "@/lib/prospection/model";
import { confirmLead } from "@/lib/prospection/server";

/**
 * POST /api/admin/prospection/leads/:id/confirm  { reply, channel }
 *
 * « Il a dit oui »: the member pastes the owner's answer (the proof of the
 * yes) and where it came from. The owner gets an account on their number, the
 * terms are recorded as accepted with that answer, and the lead's draft
 * becomes a draft annonce in their account. Nothing goes online yet.
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
  const reply = typeof body.reply === "string" ? body.reply : "";
  const channel = isChannel(body.channel) ? body.channel : null;

  const out = await confirmLead(admin, { leadId: id, actorId: gate.user.id, reply, channel });
  if (!out.ok) {
    const status = out.error === "not_found" ? 404 : out.error === "blocked" || out.error === "bad_category" ? 409 : 500;
    return NextResponse.json({ error: out.error, blockers: out.blockers }, { status });
  }
  logAction(req, gate.user, "prospect.confirm", { id, listing: out.listingId });
  return NextResponse.json({ ok: true, listingId: out.listingId, createdAccount: out.createdAccount });
}
