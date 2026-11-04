import { NextRequest, NextResponse } from "next/server";
import { jsonObject } from "@/lib/http/body";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator, requestLocale } from "@/lib/i18n/server";
import { formatTND } from "@/lib/utils";
import { agreedAmount, checkCounter, nextOfferStatus, offerExpiry, parseAmount, shownStatus, type OfferAction } from "@/lib/offers";
import { asOfferRow, offerSide, OFFER_COLUMNS } from "@/lib/offers-server";
import { getSettings } from "@/lib/settings/server";

const ACTIONS: readonly OfferAction[] = ["accept", "decline", "counter", "withdraw"];

/**
 * PATCH /api/offres/:id — answer an offer, or call it off (0211).
 *
 *   { action: "accept" | "decline", note? }        seller's side, on a waiting offer
 *   { action: "counter", amount, note? }           seller's side: once, above the offer, at most the asking price
 *   { action: "accept" | "decline" }               buyer, on the seller's counter
 *   { action: "withdraw" }                         buyer, while it is open
 *
 * The move must be allowed from the current status (src/lib/offers.ts), an
 * open offer past its time has expired, and the update only lands if nobody
 * moved it in between.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  const { id } = await params;
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  const t = await apiTranslator(req, "offersApi");
  const lang = requestLocale(req);

  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { data: row } = await admin.from("price_offers").select(OFFER_COLUMNS).eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const offer = asOfferRow(row);
  const side = await offerSide(admin, offer, user.id);
  if (!side) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Past its time, nobody can answer it any more: say so, and record it.
  if (shownStatus(offer) === "expired" && offer.status !== "expired") {
    await admin.from("price_offers").update({ status: "expired" }).eq("id", offer.id).eq("status", offer.status);
    return NextResponse.json({ error: "conflict", detail: t("expired") }, { status: 409 });
  }

  const body = await jsonObject(req);
  const action = ACTIONS.find((a) => a === body.action);
  const next = action ? nextOfferStatus(offer.status, action, side) : null;
  if (!action || !next) return NextResponse.json({ error: "conflict", detail: t("transition") }, { status: 409 });

  let counter: number | null = offer.counter_amount;
  if (action === "counter") {
    counter = parseAmount(body.amount);
    if (!counter || !checkCounter(counter, offer.amount, offer.asking_price)) {
      return NextResponse.json(
        { error: "invalid", detail: t("counter", { min: formatTND(offer.amount + 1, lang), max: formatTND(offer.asking_price, lang) }) },
        { status: 400 },
      );
    }
  }
  const note = side === "seller" && typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 400) : null;
  const settings = await getSettings();

  const { data: moved, error } = await admin
    .from("price_offers")
    .update({
      status: next,
      counter_amount: counter,
      // A counter gives the buyer the same time to answer the seller had.
      ...(action === "counter" ? { expires_at: offerExpiry(settings.offers_days) } : {}),
      ...(side === "seller" ? { seller_note: note ?? offer.seller_note, decided_by: user.id, decided_at: new Date().toISOString() } : {}),
    })
    .eq("id", offer.id)
    .eq("status", offer.status)
    .select("id");
  if (error) return fail("offer_update_failed", 500, error);
  if (!moved || moved.length === 0) return NextResponse.json({ error: "conflict", detail: t("transition") }, { status: 409 });

  const { data: listing } = await admin.from("listings").select("title").eq("id", offer.listing_id).maybeSingle();
  const title = (listing?.title as string | undefined) ?? "";
  const agreed = agreedAmount({ status: next, amount: offer.amount, counter_amount: counter });
  const withNote = { note: note ?? "", variant: note ? "with_note" : "plain" };
  const toBuyer = `/account/offres?tab=sent&o=${offer.id}`;
  const toSeller = `/account/offres?o=${offer.id}`;
  // Who hears what: the buyer hears the seller's answer, the seller hears the buyer's.
  const notice =
    side === "seller"
      ? next === "accepted"
        ? { to: offer.buyer_id, kind: "offer_accepted", title: "Offre acceptée", body: `Le vendeur accepte ${formatTND(agreed ?? offer.amount)} TND pour « ${title} ».`, link: toBuyer, vars: { title, amount: agreed ?? offer.amount, ...withNote } }
        : next === "countered"
          ? { to: offer.buyer_id, kind: "offer_countered", title: "Le vendeur propose un prix", body: `Le vendeur propose ${formatTND(counter ?? 0)} TND pour « ${title} ».`, link: toBuyer, vars: { title, amount: offer.amount, counter: counter ?? 0, ...withNote } }
          : { to: offer.buyer_id, kind: "offer_declined", title: "Offre non retenue", body: `Votre offre sur « ${title} » n'est pas retenue.`, link: toBuyer, vars: { title, amount: offer.amount, ...withNote } }
      : next === "accepted"
        ? { to: offer.seller_id, kind: "offer_counter_accepted", title: "Prix accepté", body: `${offer.buyer_name} accepte ${formatTND(agreed ?? 0)} TND pour « ${title} ».`, link: toSeller, vars: { title, name: offer.buyer_name, amount: agreed ?? 0 } }
        : next === "declined"
          ? { to: offer.seller_id, kind: "offer_counter_declined", title: "Prix refusé", body: `${offer.buyer_name} ne retient pas votre prix pour « ${title} ».`, link: toSeller, vars: { title, name: offer.buyer_name, amount: counter ?? 0 } }
          : { to: offer.seller_id, kind: "offer_withdrawn", title: "Offre retirée", body: `${offer.buyer_name} a retiré son offre sur « ${title} ».`, link: toSeller, vars: { title, name: offer.buyer_name, amount: offer.amount } };
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

  logAction(req, user, `offer.${action}`, { id: offer.id, side });
  return NextResponse.json({ ok: true, status: next });
}
