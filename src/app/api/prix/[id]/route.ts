import { NextRequest, NextResponse } from "next/server";
import { jsonObject } from "@/lib/http/body";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { asDealType } from "@/lib/listings/deal";
import { answerPrice, nextQuestionStatus, QUESTION_ACTIONS } from "@/lib/price-questions";
import { leadAfterAnswer, questionSide, QUESTION_COLUMNS, type QuestionRow } from "@/lib/price-questions-server";

/**
 * PATCH /api/prix/:id — the seller's side answers a price question (0222).
 *
 *   { action: "answer", price }   the price goes to the buyer, in the site and by SMS
 *   { action: "done" }            handled another way: he called the buyer
 *
 * Only while the question waits, and the update only lands if nobody moved it
 * in between. Not switched off with « Demander le prix »: a question already
 * asked is still answered.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  const { id } = await params;
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  const t = await apiTranslator(req, "priceQuestionsApi");

  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { data: row } = await admin.from("price_questions").select(QUESTION_COLUMNS).eq("id", id).maybeSingle();
  const question = row as unknown as QuestionRow | null;
  if (!question) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const side = await questionSide(admin, question, user.id);
  if (!side) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (side !== "seller") return NextResponse.json({ error: "forbidden", detail: t("sellerOnly") }, { status: 403 });

  const body = await jsonObject(req);
  const action = QUESTION_ACTIONS.find((a) => a === body.action);
  const next = action ? nextQuestionStatus(question.status, action) : null;
  if (!action || !next) return NextResponse.json({ error: "conflict", detail: t("transition") }, { status: 409 });

  const price = action === "answer" ? answerPrice(body.price) : null;
  if (action === "answer" && price == null) return NextResponse.json({ error: "invalid", detail: t("price") }, { status: 400 });

  const { data: moved, error } = await admin
    .from("price_questions")
    .update({ status: next, answer_price: price, answered_by: user.id, answered_at: new Date().toISOString() })
    .eq("id", question.id)
    .eq("status", "open")
    .select("id")
    .maybeSingle();
  if (error) return fail("price_question_update_failed", 500, error);
  if (!moved) return NextResponse.json({ error: "conflict", detail: t("transition") }, { status: 409 });

  await leadAfterAnswer(admin, question.id).catch(() => {});
  if (action === "answer") {
    const { data: listing } = await admin.from("listings").select("title, deal_type").eq("id", question.listing_id).maybeSingle();
    const title = (listing?.title as string | undefined) ?? "";
    const rent = asDealType(listing?.deal_type as string | null | undefined) === "rent";
    await admin
      .rpc("enqueue_notification", {
        p_user_id: question.buyer_id,
        p_kind: "price_answered",
        p_title: rent ? `Loyer : ${price} TND par mois` : `Prix : ${price} TND`,
        p_body: `« ${title} » : ${price} TND${rent ? " par mois" : ""}.`,
        p_link: `/annonces/${question.listing_id}`,
        p_payload: { vars: { title, amount: price, variant: rent ? "rent" : "sale" }, focus: question.id },
      })
      .then(() => {}, () => {});
  }

  logAction(req, user, `price_question.${action}`, { id: question.id, listing: question.listing_id });
  return NextResponse.json({ ok: true, status: next });
}
