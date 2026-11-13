import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { featureOff } from "@/lib/settings/gate";
import { fail } from "@/lib/http/errors";
import { logAction } from "@/lib/activity";
import { loadLead, sendOwnerSms, syncLeadWithListing } from "@/lib/prospection/server";

/**
 * POST /api/admin/prospection/leads/:id/sms
 *
 * Sends the owner the SMS with the link of their online annonce and their
 * private link again — when it failed the first time, or when the rules held
 * the annonce for an admin and it is online now. A new private link replaces
 * the earlier one.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req, "prospection");
  if (gate instanceof NextResponse) return gate;
  const off = await featureOff("feature_prospection");
  if (off) return off;
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  const { id } = await params;

  const found = await loadLead(admin, id);
  if (!found) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const lead = await syncLeadWithListing(admin, found);
  if (lead.status !== "online") return NextResponse.json({ error: "wrong_step" }, { status: 409 });

  const sms = await sendOwnerSms(admin, { lead, origin: req.nextUrl.origin, actorId: gate.user.id });
  logAction(req, gate.user, "prospect.sms", { id, sent: sms.sent });
  return NextResponse.json({ ok: sms.sent, sms }, { status: sms.sent ? 200 : 502 });
}
