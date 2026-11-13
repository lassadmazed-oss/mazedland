import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { featureOff } from "@/lib/settings/gate";
import { getSettings } from "@/lib/settings/server";
import { fail } from "@/lib/http/errors";
import { jsonObject } from "@/lib/http/body";
import { logAction } from "@/lib/activity";
import { TUNISIAN_GOVERNORATES } from "@/lib/tunisia";
import {
  contactsLeft, isChannel, normalizePhone, readDraft, statusAfter, type EventKind,
} from "@/lib/prospection/model";
import {
  addDoNotContact, addEvent, contactsToday, isDoNotContact, loadLead, syncDraftToListing,
} from "@/lib/prospection/server";

/**
 * PATCH /api/admin/prospection/leads/:id
 *
 *   { action: "update", draft?, phone?, name?, url?, is_broker?, assigned_to?, follow_up_at? }
 *   { action: "contacted", channel }                 — wrote to the owner (counts against the daily cap)
 *   { action: "result", kind, note?, follow_up_at? } — no_answer | thinking | refused | wrong_number
 *   { action: "note", note }
 *   { action: "reopen" }                             — a declined lead back to « à contacter »
 *
 * A refusal or a wrong number puts the number on the « ne pas contacter » list.
 * The yes has its own route (/confirm): it makes an account.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req, "prospection");
  if (gate instanceof NextResponse) return gate;
  const off = await featureOff("feature_prospection");
  if (off) return off;
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  const { id } = await params;
  const lead = await loadLead(admin, id);
  if (!lead) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await jsonObject(req);
  const action = body.action;
  const actor = gate.user.id;
  const date = (v: unknown): string | null => {
    if (typeof v !== "string" || !v) return null;
    const t = Date.parse(v);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  };

  if (action === "contacted") {
    if (lead.status === "online" || lead.status === "declined") return NextResponse.json({ error: "wrong_step" }, { status: 409 });
    if (!isChannel(body.channel)) return NextResponse.json({ error: "bad_channel" }, { status: 400 });
    if (!lead.phone) return NextResponse.json({ error: "no_phone" }, { status: 409 });
    if (await isDoNotContact(admin, lead.phone)) return NextResponse.json({ error: "do_not_contact" }, { status: 409 });
    const cap = (await getSettings()).prospect_daily_cap;
    const done = await contactsToday(admin, actor);
    if (contactsLeft(cap, done) === 0) return NextResponse.json({ error: "daily_cap", cap }, { status: 429 });
    await addEvent(admin, id, actor, "contacted", { channel: body.channel });
    await admin.from("prospect_leads").update({ status: statusAfter(lead.status, "contacted"), assigned_to: lead.assigned_to ?? actor }).eq("id", id);
    return NextResponse.json({ ok: true, left: contactsLeft(cap, done + 1) });
  }

  if (action === "result") {
    const kind = body.kind;
    if (kind !== "no_answer" && kind !== "thinking" && kind !== "refused" && kind !== "wrong_number") {
      return NextResponse.json({ error: "bad_kind" }, { status: 400 });
    }
    if (lead.status === "online" || lead.status === "confirmed") return NextResponse.json({ error: "wrong_step" }, { status: 409 });
    const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 2000) : null;
    await addEvent(admin, id, actor, kind as EventKind, { note });
    await admin
      .from("prospect_leads")
      .update({
        status: statusAfter(lead.status, kind as EventKind),
        outcome: kind,
        follow_up_at: kind === "no_answer" || kind === "thinking" ? date(body.follow_up_at) : null,
      })
      .eq("id", id);
    if ((kind === "refused" || kind === "wrong_number") && lead.phone) {
      await addDoNotContact(admin, lead.phone, actor, kind === "refused" ? "refused" : "wrong number");
    }
    return NextResponse.json({ ok: true });
  }

  if (action === "note") {
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : "";
    if (!note) return NextResponse.json({ error: "empty" }, { status: 400 });
    await addEvent(admin, id, actor, "note", { note });
    return NextResponse.json({ ok: true });
  }

  if (action === "reopen") {
    if (lead.status !== "declined") return NextResponse.json({ error: "wrong_step" }, { status: 409 });
    // A number that said no stays on the list: reopening is for a lead closed by mistake.
    if (await isDoNotContact(admin, lead.phone)) return NextResponse.json({ error: "do_not_contact" }, { status: 409 });
    await admin.from("prospect_leads").update({ status: "to_contact", outcome: null }).eq("id", id);
    return NextResponse.json({ ok: true });
  }

  if (action === "update") {
    const patch: Record<string, unknown> = {};

    if ("phone" in body) {
      const phone = body.phone === "" || body.phone === null ? null : normalizePhone(body.phone);
      if (body.phone && !phone) return NextResponse.json({ error: "bad_phone" }, { status: 400 });
      if (phone && (await isDoNotContact(admin, phone))) return NextResponse.json({ error: "do_not_contact" }, { status: 409 });
      // The account and the annonce are made on this number once the owner said yes.
      if (lead.listing_id && phone !== lead.phone) return NextResponse.json({ error: "phone_locked" }, { status: 409 });
      patch.phone = phone;
    }
    if ("name" in body) patch.poster_name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : null;
    if ("url" in body) patch.source_url = typeof body.url === "string" && /^https?:\/\//i.test(body.url.trim()) ? body.url.trim().slice(0, 600) : null;
    if ("follow_up_at" in body) patch.follow_up_at = date(body.follow_up_at);
    if ("is_broker" in body) {
      patch.is_broker = body.is_broker === true;
      if (patch.is_broker !== lead.is_broker) await addEvent(admin, id, actor, "broker", { note: patch.is_broker ? "broker" : "owner" });
    }
    if ("assigned_to" in body) {
      const to = typeof body.assigned_to === "string" ? body.assigned_to : null;
      if (to) {
        const { data: member } = await admin.from("profiles").select("id, role").eq("id", to).maybeSingle();
        if (!member || member.role !== "admin") return NextResponse.json({ error: "bad_member" }, { status: 400 });
      }
      patch.assigned_to = to;
      await addEvent(admin, id, actor, "assigned", { note: to });
    }
    if ("language" in body && (body.language === "ar" || body.language === "fr")) patch.language = body.language;

    if (body.draft && typeof body.draft === "object" && !Array.isArray(body.draft)) {
      if (lead.status === "online") return NextResponse.json({ error: "wrong_step" }, { status: 409 });
      const incoming = body.draft as Record<string, unknown>;
      if (typeof incoming.governorate === "string" && incoming.governorate && !(TUNISIAN_GOVERNORATES as readonly string[]).includes(incoming.governorate)) {
        return NextResponse.json({ error: "bad_governorate" }, { status: 400 });
      }
      if (typeof incoming.categorySlug === "string" && incoming.categorySlug) {
        const { data: cat } = await admin.from("categories").select("id, parent_id, is_active").eq("slug", incoming.categorySlug).maybeSingle();
        if (!cat || !cat.is_active || cat.parent_id == null) return NextResponse.json({ error: "bad_category" }, { status: 400 });
      }
      patch.draft = readDraft({ ...(lead.draft as Record<string, unknown>), ...incoming });
    }

    if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true, unchanged: true });
    const { error } = await admin.from("prospect_leads").update(patch).eq("id", id);
    if (error) return fail("lead_update_failed", 500, error);
    // After the yes the annonce is a draft in the owner's account: it follows the corrections.
    if (patch.draft && lead.listing_id) {
      await syncDraftToListing(admin, { ...lead, draft: patch.draft });
    }
    logAction(req, gate.user, "prospect.update", { id });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}
