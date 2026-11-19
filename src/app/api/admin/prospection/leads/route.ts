import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { featureOff } from "@/lib/settings/gate";
import { fail } from "@/lib/http/errors";
import { jsonObject } from "@/lib/http/body";
import { logAction } from "@/lib/activity";
import { extractPhones, normalizePhone, readDraft } from "@/lib/prospection/model";
import { addEvent, leadWarnings, readPost } from "@/lib/prospection/server";

/**
 * POST /api/admin/prospection/leads  { text, url?, name?, phone? }
 *
 * A post found in a group, pasted by a member of the team: the number is read
 * from the text when it is not given, the assistant reads a draft from the
 * rest (only what the post says), and the lead starts at « à contacter » in
 * the name of whoever pasted it. A number on the « ne pas contacter » list is
 * refused. Without the assistant (off, out of budget) the lead is made with an
 * empty draft and the team fills it in by hand.
 */
export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, "prospection");
  if (gate instanceof NextResponse) return gate;
  const off = await featureOff("feature_prospection");
  if (off) return off;
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const body = await jsonObject(req);
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 8000) : "";
  if (text.length < 20) return NextResponse.json({ error: "too_short" }, { status: 400 });
  const url = typeof body.url === "string" && /^https?:\/\//i.test(body.url.trim()) ? body.url.trim().slice(0, 600) : null;
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : null;
  const phone = normalizePhone(body.phone) ?? extractPhones(text)[0] ?? null;

  const warnings = await leadWarnings(admin, { phone, sourceUrl: url });
  if (warnings.doNotContact) return NextResponse.json({ error: "do_not_contact" }, { status: 409 });

  // Sixty posts an hour is more than anyone pastes; it caps the assistant's cost.
  const { data: over } = await admin.rpc("check_rate_limit", {
    p_key: `prospect-ai:${gate.user.id}`,
    p_max: 60,
    p_window_secs: 3600,
  });
  if (over === true) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const read = await readPost(admin, gate.user.id, text);
  const draft = read.ok ? read.draft : readDraft(null);
  const language = read.ok ? read.language : /[؀-ۿ]/.test(text) ? "ar" : "fr";

  const { data: created, error } = await admin
    .from("prospect_leads")
    .insert({
      status: "to_contact",
      phone,
      poster_name: name,
      source_url: url,
      source_text: text,
      language,
      draft,
      assigned_to: gate.user.id,
      created_by: gate.user.id,
    })
    .select("id")
    .single();
  if (error || !created) return fail("lead_create_failed", 500, error);

  await addEvent(admin, created.id as string, gate.user.id, "created", { note: read.ok ? null : `assistant: ${read.reason}` });
  logAction(req, gate.user, "prospect.create", { id: created.id });
  return NextResponse.json({ ok: true, id: created.id, ai: read.ok, warnings });
}
