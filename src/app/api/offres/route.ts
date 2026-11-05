import { NextRequest, NextResponse } from "next/server";
import { jsonObject } from "@/lib/http/body";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator, requestLocale } from "@/lib/i18n/server";
import { anyPhoneToE164 } from "@/lib/tunisia";
import { formatTND } from "@/lib/utils";
import { personName } from "@/lib/visits";
import { checkAmount, FINANCING, offerExpiry, offerFloor, offerReceivedBySms, parseAmount, takesOffers, type Financing } from "@/lib/offers";
import { asOfferRow, expireDue, leadForOffer, OFFER_COLUMNS } from "@/lib/offers-server";
import { roleIn } from "@/lib/pro/shops";
import { featureOff } from "@/lib/settings/gate";
import { getSettings } from "@/lib/settings/server";

/**
 * POST /api/offres — propose a price on an annonce (0211).
 *
 *   { listingId, amount, financing?: "cash" | "loan", name, phone, message? }
 *
 * Signed in only, never on one's own annonce, one open offer per annonce and
 * at most `offers_max_per_listing` in all. The amount lies between
 * `offers_min_percent` of the asking price and the asking price. The name and
 * number go to the seller with the offer, and the form says so. On a shop's
 * annonce the buyer also becomes one of the shop's clients. Switched off, no
 * new offer; those already made are still answered (PATCH /api/offres/:id).
 */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  const off = await featureOff("feature_offers");
  if (off) return off;
  const settings = await getSettings();
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  const t = await apiTranslator(req, "offersApi");

  const body = await jsonObject(req);
  const listingId = typeof body.listingId === "string" && /^[0-9a-f-]{36}$/i.test(body.listingId) ? body.listingId : null;
  const amount = parseAmount(body.amount);
  if (!amount) return NextResponse.json({ error: "invalid", detail: t("amount") }, { status: 400 });
  const phone = anyPhoneToE164(body.phone);
  if (!phone) return NextResponse.json({ error: "invalid", detail: t("phone") }, { status: 400 });
  // A name, not a message: it reaches the seller under the platform's name.
  const name = personName(body.name);
  if (!name) {
    const typed = typeof body.name === "string" && body.name.trim().length >= 2;
    return NextResponse.json({ error: "invalid", detail: t(typed ? "nameLetters" : "name") }, { status: 400 });
  }
  const financing: Financing | null = FINANCING.find((f) => f === body.financing) ?? null;
  const message = typeof body.message === "string" && body.message.trim() ? body.message.trim().slice(0, 600) : null;

  const { data: listing } = listingId
    ? await admin
        .from("listings")
        .select("id, seller_id, shop_id, status, title, price, price_on_request, deal_type, negotiable, availability")
        .eq("id", listingId)
        .maybeSingle()
    : { data: null };
  if (!listing || listing.status !== "published") return NextResponse.json({ error: "not_found", detail: t("notOnline") }, { status: 404 });
  // Its seller, or anyone on its agence's team: they would be bargaining with themselves.
  if (listing.seller_id === user.id || (listing.shop_id && (await roleIn(admin, listing.shop_id, user.id)))) {
    return NextResponse.json({ error: "invalid", detail: t("own") }, { status: 400 });
  }
  const scope = { onlyNegotiable: settings.offers_only_negotiable, rent: settings.offers_rent };
  if (!takesOffers({ ...listing, price: listing.price == null ? null : Number(listing.price) }, scope)) {
    return NextResponse.json({ error: "invalid", detail: t("notOffered") }, { status: 400 });
  }
  const asking = Number(listing.price);
  const lang = requestLocale(req);
  const check = checkAmount(amount, asking, settings.offers_min_percent);
  if (check === "too_low") {
    return NextResponse.json({ error: "invalid", detail: t("tooLow", { amount: formatTND(offerFloor(asking, settings.offers_min_percent), lang) }) }, { status: 400 });
  }
  if (check === "too_high") {
    return NextResponse.json({ error: "invalid", detail: t("tooHigh", { amount: formatTND(asking, lang) }) }, { status: 400 });
  }

  // An offer past its time no longer holds the place of the open one.
  await expireDue(admin, { listing: listing.id, buyer: user.id }).catch(() => {});
  // A buyer turned down may try again, up to the console's number: beyond
  // it, each new offer would only probe the seller's lowest price.
  const { data: made } = await admin
    .from("price_offers")
    .select("status")
    .eq("listing_id", listing.id)
    .eq("buyer_id", user.id);
  // Both sides already agreed on a price here: another offer would only undo it.
  if ((made ?? []).some((o) => o.status === "accepted")) {
    return NextResponse.json({ error: "conflict", detail: t("agreed") }, { status: 409 });
  }
  if ((made ?? []).length >= settings.offers_max_per_listing) {
    return NextResponse.json({ error: "conflict", detail: t("maxReached", { count: settings.offers_max_per_listing }) }, { status: 409 });
  }

  // Counted here, after the checks: a mistyped amount must not spend the day's offers.
  const { data: over } = await admin.rpc("check_rate_limit", { p_key: `offer:${user.id}`, p_max: settings.limit_offers_per_day, p_window_secs: 86_400 });
  if (over === true) return NextResponse.json({ error: "rate_limited", detail: t("tooMany") }, { status: 429 });

  const { data: created, error } = await admin
    .from("price_offers")
    .insert({
      listing_id: listing.id,
      buyer_id: user.id,
      seller_id: listing.seller_id,
      shop_id: listing.shop_id ?? null,
      asking_price: asking,
      amount,
      financing,
      buyer_name: name,
      buyer_phone: phone,
      message,
      expires_at: offerExpiry(settings.offers_days),
    })
    .select(OFFER_COLUMNS)
    .single();
  if (error?.code === "23505") return NextResponse.json({ error: "conflict", detail: t("alreadyOpen") }, { status: 409 });
  if (error || !created) return fail("offer_create_failed", 500, error);
  const offer = asOfferRow(created);

  await leadForOffer(admin, offer).catch(() => {});
  // By SMS too when the seller said « négociable »; otherwise the bell only.
  const sms = offerReceivedBySms(listing, settings.offers_sms_only_negotiable);
  await admin
    .rpc("enqueue_notification", {
      p_user_id: listing.seller_id,
      p_kind: "offer_received",
      p_title: "Nouvelle offre",
      p_body: `${name} propose ${formatTND(amount)} TND pour « ${listing.title} ».`,
      p_link: `/account/offres?o=${offer.id}`,
      p_payload: { vars: { title: listing.title, name, amount, asking }, ...(sms ? {} : { sms: false }) },
    })
    .then(() => {}, () => {});

  logAction(req, user, "offer.create", { id: offer.id, listing: listing.id });
  return NextResponse.json({ ok: true, id: offer.id, status: offer.status, expiresAt: offer.expires_at });
}
