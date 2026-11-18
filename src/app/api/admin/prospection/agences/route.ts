import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { featureOff } from "@/lib/settings/gate";
import { fail } from "@/lib/http/errors";
import { jsonObject } from "@/lib/http/body";
import { logAction } from "@/lib/activity";
import { governorateChoice } from "@/lib/tunisia";
import { normalizePhone } from "@/lib/prospection/model";
import { addAgencyEvent, syncAgencyShops } from "@/lib/prospection/agencies/server";
import { isAgencySource, mayWorkAgency } from "@/lib/prospection/agencies/model";

/**
 * POST /api/admin/prospection/agences  { name, phone?, phone2?, governorate?, city?, address?, website?, facebook_url?, source?, assign_to? }
 *
 * One agency added by hand (a page found on Facebook, a card, a call). A member
 * holds what they add; the whole console may give it to someone. A number
 * already on the list answers 409 `duplicate` with the agency it belongs to; a
 * number on the « ne pas contacter » list is refused (`do_not_contact`).
 */
export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, "prospection");
  if (gate instanceof NextResponse) return gate;
  const off = await featureOff("feature_prospection");
  if (off) return off;
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const body = await jsonObject(req);
  const text = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
  const name = text(body.name, 160);
  if (!name) return NextResponse.json({ error: "no_name" }, { status: 400 });

  const phone = body.phone ? normalizePhone(body.phone) : null;
  const phone2 = body.phone2 ? normalizePhone(body.phone2) : null;
  if ((body.phone && !phone) || (body.phone2 && !phone2)) return NextResponse.json({ error: "bad_phone" }, { status: 400 });
  const website = text(body.website, 300);
  const facebook = text(body.facebook_url, 600);
  if (!phone && !website && !facebook) return NextResponse.json({ error: "nothing_to_reach" }, { status: 400 });

  const gov = governorateChoice(body.governorate ?? null);
  if (!gov.ok) return NextResponse.json({ error: "bad_governorate" }, { status: 400 });

  for (const p of [phone, phone2]) {
    if (!p) continue;
    const { data: dnc } = await admin.from("prospect_dnc").select("phone").eq("phone", p).maybeSingle();
    if (dnc) return NextResponse.json({ error: "do_not_contact" }, { status: 409 });
    const { data: dup } = await admin.from("prospect_agencies").select("id, assigned_to").or(`phone.eq.${p},phone2.eq.${p}`).limit(1).maybeSingle();
    // The id is given only to who may open that agency: a colleague's is theirs, not ours to point at.
    if (dup) return NextResponse.json({ error: "duplicate", id: mayWorkAgency(gate.scopes, gate.user.id, { assigned_to: (dup.assigned_to as string | null) ?? null }) ? dup.id : undefined }, { status: 409 });
  }

  // A member holds what they add; the whole console may give it to someone, or leave it for the sharing out.
  const everyone = gate.scopes === null;
  const assignTo = everyone ? (typeof body.assign_to === "string" && body.assign_to ? body.assign_to : null) : gate.user.id;

  const { data: created, error } = await admin
    .from("prospect_agencies")
    .insert({
      name, phone, phone2, governorate: gov.value, city: text(body.city, 120), address: text(body.address, 300),
      website, facebook_url: facebook, source: isAgencySource(body.source) ? body.source : "manual",
      assigned_to: assignTo, created_by: gate.user.id,
    })
    .select("id")
    .single();
  if (error || !created) {
    if (error?.code === "23505") return NextResponse.json({ error: "duplicate" }, { status: 409 });
    return fail("agency_create_failed", 500, error);
  }
  await addAgencyEvent(admin, created.id as string, gate.user.id, "created");
  await syncAgencyShops(admin).catch(() => undefined);
  logAction(req, gate.user, "prospect.agency.create", { id: created.id });
  return NextResponse.json({ ok: true, id: created.id });
}
