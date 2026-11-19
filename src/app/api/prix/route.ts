import { NextRequest, NextResponse } from "next/server";
import { jsonObject } from "@/lib/http/body";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { anyPhoneToE164 } from "@/lib/tunisia";
import { personName } from "@/lib/visits";
import { questionMessage, takesQuestions } from "@/lib/price-questions";
import { leadForQuestion, QUESTION_COLUMNS, type QuestionRow } from "@/lib/price-questions-server";
import { featureOff } from "@/lib/settings/gate";
import { getSettings } from "@/lib/settings/server";

/**
 * POST /api/prix — ask the price of an annonce « Prix sur demande » (0222).
 *
 *   { listingId, name, phone, message? }
 *
 * Signed in only, never on one's own annonce, one open question per annonce.
 * The name and number go to the seller — that is the point, and the form says
 * so; the SMS says « un acheteur » (src/lib/sms-kinds.ts). On a shop's annonce
 * the buyer also becomes one of the shop's clients. Switched off, no new
 * question; those already asked are still answered (PATCH /api/prix/:id).
 */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  const off = await featureOff("feature_price_questions");
  if (off) return off;
  const settings = await getSettings();
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  const t = await apiTranslator(req, "priceQuestionsApi");

  const body = await jsonObject(req);
  const listingId = typeof body.listingId === "string" && /^[0-9a-f-]{36}$/i.test(body.listingId) ? body.listingId : null;
  const phone = anyPhoneToE164(body.phone);
  if (!phone) return NextResponse.json({ error: "invalid", detail: t("phone") }, { status: 400 });
  // A name, not a message: it reaches the seller under the platform's name.
  const name = personName(body.name);
  if (!name) {
    const typed = typeof body.name === "string" && body.name.trim().length >= 2;
    return NextResponse.json({ error: "invalid", detail: t(typed ? "nameLetters" : "name") }, { status: 400 });
  }
  const message = questionMessage(body.message);

  const { data: listing } = listingId
    ? await admin
        .from("listings")
        .select("id, seller_id, shop_id, status, title, reference, price_on_request")
        .eq("id", listingId)
        .maybeSingle()
    : { data: null };
  if (!listing || listing.status !== "published") return NextResponse.json({ error: "not_found", detail: t("notOnline") }, { status: 404 });
  if (!takesQuestions(listing)) return NextResponse.json({ error: "invalid", detail: t("hasPrice") }, { status: 400 });
  if (listing.seller_id === user.id) return NextResponse.json({ error: "invalid", detail: t("own") }, { status: 400 });

  // Counted after the checks, like the visits: a mistyped form must not spend the day's questions.
  const { data: over } = await admin.rpc("check_rate_limit", {
    p_key: `price_question:${user.id}`,
    p_max: settings.limit_price_questions_per_day,
    p_window_secs: 86_400,
  });
  if (over === true) return NextResponse.json({ error: "rate_limited", detail: t("tooMany") }, { status: 429 });

  const { data: created, error } = await admin
    .from("price_questions")
    .insert({
      listing_id: listing.id,
      buyer_id: user.id,
      seller_id: listing.seller_id,
      shop_id: listing.shop_id ?? null,
      buyer_name: name,
      buyer_phone: phone,
      message,
    })
    .select(QUESTION_COLUMNS)
    .single();
  if (error?.code === "23505") return NextResponse.json({ error: "conflict", detail: t("alreadyOpen") }, { status: 409 });
  if (error || !created) return fail("price_question_create_failed", 500, error);
  const question = created as unknown as QuestionRow;

  await leadForQuestion(admin, question).catch(() => {});
  await admin
    .rpc("enqueue_notification", {
      p_user_id: listing.seller_id,
      p_kind: "price_question",
      p_title: "Demande de prix",
      p_body: `${name} demande le prix de « ${listing.title} ».`,
      p_link: `/account/prix?q=${question.id}`,
      p_payload: { vars: { title: listing.title, name }, focus: question.id },
    })
    .then(() => {}, () => {});

  logAction(req, user, "price_question.ask", { id: question.id, listing: listing.id });
  return NextResponse.json({ ok: true, id: question.id });
}
