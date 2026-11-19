import { NextRequest, NextResponse } from "next/server";
import { jsonObject } from "@/lib/http/body";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { getSettings } from "@/lib/settings/server";
import { isProposalReason, nextStatus, parseProposal, pickSlot, PROPOSAL_NOTE_MAX, tunisDay, type VisitAction, type VisitSlot } from "@/lib/visits";
import { syncLeadStage, visitSide, VISIT_COLUMNS, type VisitRow } from "@/lib/visits-server";

const ACTIONS: readonly VisitAction[] = ["confirm", "propose", "accept", "decline", "done", "cancel"];

/**
 * PATCH /api/visites/:id — answer or call off a visit request (0174).
 *
 *   { action: "confirm", slot: { day, part }, note? }   seller's side
 *   { action: "propose", slot: { day, part }, reason, note? }
 *                                                        seller's side: another moment (0231), the buyer answers
 *   { action: "decline" | "done" | "cancel", note? }    seller's side
 *   { action: "accept" }                                 buyer: the moment the seller proposed
 *   { action: "cancel" }                                 buyer
 *
 * The move must be allowed from the current status (src/lib/visits.ts), and
 * the update only lands if nobody moved it in between.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  const { id } = await params;
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  const t = await apiTranslator(req, "visitsApi");

  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { data: row } = await admin.from("visit_requests").select(VISIT_COLUMNS).eq("id", id).maybeSingle();
  const visit = row as unknown as VisitRow | null;
  if (!visit) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const side = await visitSide(admin, visit, user.id);
  if (!side) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await jsonObject(req);
  const action = ACTIONS.find((a) => a === body.action);
  const next = action ? nextStatus(visit.status, action, side) : null;
  if (!action || !next) return NextResponse.json({ error: "conflict", detail: t("transition") }, { status: 409 });

  let slot: VisitSlot | null = visit.confirmed_slot;
  let proposal: { slot: VisitSlot; reason: string; note: string | null } | null = null;
  if (action === "confirm") {
    slot = pickSlot(visit.slots, body.slot);
    if (!slot) return NextResponse.json({ error: "invalid", detail: t("slot") }, { status: 400 });
  }
  if (action === "propose") {
    // Another moment inside the same window as the buyer's own, and why — a choice, with a short word.
    const horizon = (await getSettings()).visits_horizon_days;
    const proposed = parseProposal(body.slot, tunisDay(), horizon);
    if (!proposed) return NextResponse.json({ error: "invalid", detail: t("slot") }, { status: 400 });
    if (!isProposalReason(body.reason)) return NextResponse.json({ error: "invalid", detail: t("reason") }, { status: 400 });
    const word = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, PROPOSAL_NOTE_MAX) : null;
    proposal = { slot: proposed, reason: body.reason, note: word };
  }
  if (action === "accept") {
    // The buyer takes the moment the seller proposed: it becomes the confirmed one.
    slot = visit.proposed_slot;
    if (!slot) return NextResponse.json({ error: "conflict", detail: t("transition") }, { status: 409 });
  }
  const note = side === "seller" && action !== "propose" && typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 400) : null;
  const now = new Date().toISOString();

  const { data: moved, error } = await admin
    .from("visit_requests")
    .update({
      status: next,
      confirmed_slot: slot,
      // The first answer is the one the agence's reactivity counts: a proposal is an answer, a revision is not a new one.
      ...(side === "seller" ? { seller_note: note ?? visit.seller_note, decided_by: user.id, decided_at: visit.decided_at ?? now } : {}),
      ...(proposal ? { proposed_slot: proposal.slot, proposal_reason: proposal.reason, proposal_note: proposal.note, proposed_at: now } : {}),
    })
    .eq("id", visit.id)
    .eq("status", visit.status)
    .select("id");
  if (error) return fail("visit_update_failed", 500, error);
  if (!moved || moved.length === 0) return NextResponse.json({ error: "conflict", detail: t("transition") }, { status: 409 });

  await syncLeadStage(admin, visit.id, next).catch(() => {});

  const { data: listing } = await admin.from("listings").select("title").eq("id", visit.listing_id).maybeSingle();
  const title = (listing?.title as string | undefined) ?? "";
  // Who hears what: the buyer hears the seller's answer, the seller hears the buyer call it off.
  const notice =
    side === "buyer" && action === "accept"
      ? { to: visit.seller_id, kind: "visit_accepted", title: "Créneau accepté", body: `${visit.buyer_name} a accepté le créneau proposé pour « ${title} ».`, link: `/account/visites?v=${visit.id}`, vars: { title, name: visit.buyer_name, visit_day: slot!.day, visit_part: slot!.part } }
    : side === "buyer"
      ? { to: visit.seller_id, kind: "visit_cancelled", title: "Visite annulée", body: `${visit.buyer_name} a annulé sa visite de « ${title} ».`, link: `/account/visites?v=${visit.id}`, vars: { title, name: visit.buyer_name } }
      : proposal
        ? { to: visit.buyer_id, kind: "visit_proposed", title: "Un autre moment vous est proposé", body: `Le vendeur vous propose un autre moment pour « ${title} ».`, link: `/account/visites?tab=sent&v=${visit.id}`, vars: { title, visit_day: proposal.slot.day, visit_part: proposal.slot.part, note: proposal.note ?? "", variant: proposal.note ? "with_note" : "plain" } }
      : next === "confirmed"
        ? { to: visit.buyer_id, kind: "visit_confirmed", title: "Visite confirmée", body: `Votre visite de « ${title} » est confirmée.`, link: `/account/visites?tab=sent&v=${visit.id}`, vars: { title, visit_day: slot!.day, visit_part: slot!.part, note: note ?? "", variant: note ? "with_note" : "plain" } }
        : next === "declined" || next === "cancelled"
          ? { to: visit.buyer_id, kind: "visit_declined", title: "Visite non retenue", body: `Votre visite de « ${title} » n'aura pas lieu.`, link: `/annonces/${visit.listing_id}`, vars: { title, note: note ?? "", variant: note ? "with_note" : "plain" } }
          : null;
  if (notice) {
    await admin
      .rpc("enqueue_notification", {
        p_user_id: notice.to,
        p_kind: notice.kind,
        p_title: notice.title,
        p_body: notice.body,
        p_link: notice.link,
        p_payload: { vars: notice.vars },
      })
      .then(() => {}, () => {});
  }

  logAction(req, user, `visit.${action}`, { id: visit.id, side });
  return NextResponse.json({ ok: true, status: next });
}
