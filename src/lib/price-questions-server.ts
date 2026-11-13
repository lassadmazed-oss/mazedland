/**
 * Price questions on the server (0222): who stands on which side of one, the
 * client card a shop gets with it, and the lists « Demandes de prix » shows.
 * Service role; callers have checked the session.
 */
import type { getServiceSupabase } from "@/lib/supabase/admin";
import { can, roleIn } from "@/lib/pro/shops";
import type { QuestionStatus } from "@/lib/price-questions";

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

export const QUESTION_COLUMNS =
  "id, listing_id, buyer_id, seller_id, shop_id, buyer_name, buyer_phone, message, status, answer_price, answered_at, created_at";

export type QuestionRow = {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  shop_id: string | null;
  buyer_name: string;
  /** Null once the buyer deleted their account. */
  buyer_phone: string | null;
  message: string | null;
  status: QuestionStatus;
  answer_price: number | string | null;
  answered_at: string | null;
  created_at: string;
};

/**
 * Which side of a question this person is on: the seller is the person who
 * listed the annonce and, for a shop's annonce, anyone on the shop's team who
 * looks after its clients.
 */
export async function questionSide(
  admin: Admin,
  q: Pick<QuestionRow, "seller_id" | "buyer_id" | "shop_id">,
  userId: string,
): Promise<"seller" | "buyer" | null> {
  if (q.seller_id === userId) return "seller";
  if (q.shop_id && can(await roleIn(admin, q.shop_id, userId), "clients")) return "seller";
  if (q.buyer_id === userId) return "buyer";
  return null;
}

/**
 * A question on a shop's annonce puts its buyer in the shop's clients: the
 * open card for this buyer and annonce if there is one, a new one otherwise.
 */
export async function leadForQuestion(admin: Admin, q: QuestionRow): Promise<void> {
  if (!q.shop_id) return;
  const { data: open } = await admin
    .from("leads")
    .select("id")
    .eq("shop_id", q.shop_id)
    .eq("buyer_id", q.buyer_id)
    .eq("listing_id", q.listing_id)
    .not("stage", "in", "(won,lost)")
    .limit(1)
    .maybeSingle();
  if (open) {
    await admin.from("leads").update({ question_id: q.id, phone: q.buyer_phone }).eq("id", open.id);
    return;
  }
  await admin.from("leads").insert({
    shop_id: q.shop_id,
    listing_id: q.listing_id,
    buyer_id: q.buyer_id,
    question_id: q.id,
    name: q.buyer_name,
    phone: q.buyer_phone,
    source: "price_question",
    stage: "new",
  });
}

/** Answered or handled: the client card moves from « nouveau » to « contacté ». */
export async function leadAfterAnswer(admin: Admin, questionId: string): Promise<void> {
  const { data: lead } = await admin.from("leads").select("id, stage").eq("question_id", questionId).maybeSingle();
  if (lead && lead.stage === "new") await admin.from("leads").update({ stage: "contacted" }).eq("id", lead.id);
}

export type QuestionView = QuestionRow & {
  listing: { id: string; title: string; reference: string | null; deal_type: string | null; photo: string | null } | null;
};

/** Questions with their annonce's title, reference and first photo, newest first. */
export async function loadQuestions(admin: Admin, by: { seller?: string; buyer?: string }, limit = 100): Promise<QuestionView[]> {
  let q = admin
    .from("price_questions")
    .select(
      `${QUESTION_COLUMNS}, listing:listings!price_questions_listing_id_fkey (id, title, reference, deal_type, photos:listing_photos (storage_path, sort_order))`,
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (by.seller) q = q.eq("seller_id", by.seller);
  if (by.buyer) q = q.eq("buyer_id", by.buyer);
  const { data } = await q;
  type RawListing = {
    id: string;
    title: string;
    reference: string | null;
    deal_type: string | null;
    photos: { storage_path: string; sort_order: number }[] | null;
  };
  type Raw = QuestionRow & { listing: RawListing | RawListing[] | null };
  return ((data ?? []) as unknown as Raw[]).map((row) => {
    const l = Array.isArray(row.listing) ? row.listing[0] : row.listing;
    const photo = l?.photos?.slice().sort((a, b) => a.sort_order - b.sort_order)[0]?.storage_path ?? null;
    return {
      ...row,
      listing: l ? { id: l.id, title: l.title, reference: l.reference, deal_type: l.deal_type, photo } : null,
    };
  });
}
