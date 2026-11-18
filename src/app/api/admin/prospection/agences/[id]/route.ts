import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { featureOff } from "@/lib/settings/gate";
import { fail } from "@/lib/http/errors";
import { jsonObject } from "@/lib/http/body";
import { logAction } from "@/lib/activity";
import { governorateChoice } from "@/lib/tunisia";
import { isChannel, normalizePhone } from "@/lib/prospection/model";
import { addAgencyEvent, assignAgency, loadOwnAgency, recordContact, recordResult, reopenAgency } from "@/lib/prospection/agencies/server";
import { canRecord, isDeclineReason, isResult, resultBlockers } from "@/lib/prospection/agencies/model";

/**
 * PATCH /api/admin/prospection/agences/:id
 *
 *   { action: "update", name?, phone?, phone2?, governorate?, city?, address?, website?, facebook_url?, email?, legal_id?, licensed? }
 *   { action: "result", kind, channel?, reason?, note?, follow_up_at?, do_not_contact? }
 *                                                           — no_answer | callback | info_sent | interested | declined;
 *                                                             records the call too (channel defaults to « call »)
 *   { action: "note", note }
 *   { action: "reopen" }                                    — an agency that said no, back to « à appeler »
 *   { action: "assign", assigned_to }                       — the whole console only
 *
 * A member opens the agencies in their charge only. Calls are not capped: the
 * daily cap protects the number the team writes from, and a call cannot get a
 * number blocked.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req, "prospection");
  if (gate instanceof NextResponse) return gate;
  const off = await featureOff("feature_prospection");
  if (off) return off;
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  const { id } = await params;
  const agency = await loadOwnAgency(admin, id, { scopes: gate.scopes, userId: gate.user.id });
  if (!agency) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await jsonObject(req);
  const action = body.action;
  const actor = gate.user.id;
  const text = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
  const date = (v: unknown): string | null => {
    if (typeof v !== "string" || !v) return null;
    const t = Date.parse(v);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  };

  if (action === "result") {
    if (!isResult(body.kind)) return NextResponse.json({ error: "bad_kind" }, { status: 400 });
    if (!canRecord(agency.status)) return NextResponse.json({ error: "wrong_step" }, { status: 409 });
    const followUpAt = date(body.follow_up_at);
    const blockers = resultBlockers({ kind: body.kind, reason: body.reason, followUpAt });
    if (blockers.length > 0) return NextResponse.json({ error: "blocked", blockers }, { status: 400 });
    // One click records the call and what came of it: the day's « calls made » counts every attempt, answered or not.
    await recordContact(admin, agency, actor, isChannel(body.channel) ? body.channel : "call");
    await recordResult(admin, agency, actor, {
      kind: body.kind,
      reason: isDeclineReason(body.reason) ? body.reason : null,
      followUpAt,
      note: text(body.note, 1000),
      doNotContact: body.do_not_contact === true,
    });
    logAction(req, gate.user, "prospect.agency.result", { id, kind: body.kind });
    return NextResponse.json({ ok: true });
  }

  if (action === "note") {
    const note = text(body.note, 2000);
    if (!note) return NextResponse.json({ error: "empty" }, { status: 400 });
    await addAgencyEvent(admin, id, actor, "note", { note });
    return NextResponse.json({ ok: true });
  }

  if (action === "reopen") {
    if (agency.status !== "declined") return NextResponse.json({ error: "wrong_step" }, { status: 409 });
    if (!(await reopenAgency(admin, agency, actor))) return NextResponse.json({ error: "do_not_contact" }, { status: 409 });
    return NextResponse.json({ ok: true });
  }

  if (action === "assign") {
    if (gate.scopes !== null) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const to = typeof body.assigned_to === "string" && body.assigned_to ? body.assigned_to : null;
    if (to) {
      const { data: member } = await admin.from("profiles").select("id").eq("id", to).eq("role", "admin").is("banned_at", null).maybeSingle();
      if (!member) return NextResponse.json({ error: "bad_member" }, { status: 400 });
    }
    await assignAgency(admin, id, to, actor);
    return NextResponse.json({ ok: true });
  }

  if (action === "update") {
    const patch: Record<string, unknown> = {};
    if ("name" in body) {
      const name = text(body.name, 160);
      if (!name) return NextResponse.json({ error: "no_name" }, { status: 400 });
      patch.name = name;
    }
    for (const key of ["phone", "phone2"] as const) {
      if (!(key in body)) continue;
      if (!body[key]) { patch[key] = null; continue; }
      const p = normalizePhone(body[key]);
      if (!p) return NextResponse.json({ error: "bad_phone" }, { status: 400 });
      patch[key] = p;
    }
    if ("governorate" in body) {
      const gov = governorateChoice(body.governorate);
      if (!gov.ok) return NextResponse.json({ error: "bad_governorate" }, { status: 400 });
      patch.governorate = gov.value;
    }
    for (const [key, max] of [["city", 120], ["address", 300], ["website", 300], ["facebook_url", 600], ["email", 200], ["legal_id", 60]] as const) {
      if (key in body) patch[key] = text(body[key], max);
    }
    if ("licensed" in body) patch.licensed = typeof body.licensed === "boolean" ? body.licensed : null;
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: "nothing" }, { status: 400 });
    const { error } = await admin.from("prospect_agencies").update(patch).eq("id", id);
    if (error) {
      if (error.code === "23505") return NextResponse.json({ error: "duplicate" }, { status: 409 });
      return fail("agency_update_failed", 500, error);
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "bad_action" }, { status: 400 });
}
