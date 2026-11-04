/**
 * Price offers on the server (0211): who is on which side of one, the client
 * card a shop gets with it, and the lists « Mes offres » and the Espace Pro
 * show. Service role; callers have checked the session.
 */
import type { getServiceSupabase } from "@/lib/supabase/admin";
import { can, roleIn } from "@/lib/pro/shops";
import type { LeadStage } from "@/lib/visits";
import { OPEN_OFFER_STATUSES, stageAfterOffer, type Financing, type OfferSide, type OfferStatus } from "@/lib/offers";

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

export const OFFER_COLUMNS =
  "id, listing_id, buyer_id, seller_id, shop_id, asking_price, amount, counter_amount, financing, buyer_name, buyer_phone, message, seller_note, status, expires_at, decided_at, created_at";

export type OfferRow = {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  shop_id: string | null;
  asking_price: number;
  amount: number;
  counter_amount: number | null;
  financing: Financing | null;
  buyer_name: string;
  buyer_phone: string | null;
  message: string | null;
  seller_note: string | null;
  status: OfferStatus;
  expires_at: string;
  decided_at: string | null;
  created_at: string;
};

/** PostgREST hands numeric columns back as numbers or strings depending on size: numbers here. */
export function asOfferRow(raw: unknown): OfferRow {
  const r = raw as OfferRow;
  return {
    ...r,
    asking_price: Number(r.asking_price),
    amount: Number(r.amount),
    counter_amount: r.counter_amount == null ? null : Number(r.counter_amount),
  };
}

/**
 * Which side of an offer this person is on. The seller's side is the person
 * who listed the annonce, and, for a shop's annonce, anyone on the shop's
 * team who handles its clients.
 */
export async function offerSide(admin: Admin, o: Pick<OfferRow, "seller_id" | "buyer_id" | "shop_id">, userId: string): Promise<OfferSide | null> {
  if (o.seller_id === userId) return "seller";
  if (o.shop_id && can(await roleIn(admin, o.shop_id, userId), "clients")) return "seller";
  if (o.buyer_id === userId) return "buyer";
  return null;
}

/** Marks this buyer's offers on this annonce that ran out of time, so a new one may be made. */
export async function expireDue(admin: Admin, by: { listing: string; buyer: string }): Promise<void> {
  await admin
    .from("price_offers")
    .update({ status: "expired" })
    .eq("listing_id", by.listing)
    .eq("buyer_id", by.buyer)
    .in("status", OPEN_OFFER_STATUSES as OfferStatus[])
    .lte("expires_at", new Date().toISOString());
}

/**
 * An offer on a shop's annonce puts its buyer in the shop's clients, at the
 * negotiation: the open card for this buyer and annonce if there is one, a
 * new one otherwise.
 */
export async function leadForOffer(admin: Admin, o: OfferRow): Promise<void> {
  if (!o.shop_id) return;
  const { data: open } = await admin
    .from("leads")
    .select("id, stage")
    .eq("shop_id", o.shop_id)
    .eq("buyer_id", o.buyer_id)
    .eq("listing_id", o.listing_id)
    .not("stage", "in", "(won,lost)")
    .limit(1)
    .maybeSingle();
  if (open) {
    await admin
      .from("leads")
      .update({ offer_id: o.id, phone: o.buyer_phone, stage: stageAfterOffer(open.stage as LeadStage) })
      .eq("id", open.id);
    return;
  }
  await admin.from("leads").insert({
    shop_id: o.shop_id,
    listing_id: o.listing_id,
    buyer_id: o.buyer_id,
    offer_id: o.id,
    name: o.buyer_name,
    phone: o.buyer_phone,
    source: "offer",
    stage: "negotiation",
  });
}

export type OfferView = OfferRow & {
  listing: {
    id: string;
    title: string;
    photo: string | null;
    online: boolean;
    /** The seller's number, for the buyer, once the offer is accepted — and only then. */
    sellerPhone: string | null;
    sellerName: string | null;
  } | null;
};

type RawListing = {
  id: string;
  title: string;
  status: string;
  contact_phone: string | null;
  contact_name: string | null;
  photos: { storage_path: string; sort_order: number }[] | null;
};

/** Offers with their annonce's title and first photo, newest first. */
export async function loadOffers(
  admin: Admin,
  by: { seller?: string; buyer?: string; shop?: string },
  limit = 100,
): Promise<OfferView[]> {
  let q = admin
    .from("price_offers")
    .select(`${OFFER_COLUMNS}, listing:listings!price_offers_listing_id_fkey (id, title, status, contact_phone, contact_name, photos:listing_photos (storage_path, sort_order))`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (by.seller) q = q.eq("seller_id", by.seller);
  if (by.buyer) q = q.eq("buyer_id", by.buyer);
  if (by.shop) q = q.eq("shop_id", by.shop);
  const { data } = await q;
  type Raw = OfferRow & { listing: RawListing | RawListing[] | null };
  return ((data ?? []) as unknown as Raw[]).map((raw) => {
    const o = asOfferRow(raw);
    const l = Array.isArray(raw.listing) ? raw.listing[0] : raw.listing;
    const photo = l?.photos?.slice().sort((a, b) => a.sort_order - b.sort_order)[0]?.storage_path ?? null;
    const agreed = o.status === "accepted";
    return {
      ...o,
      listing: l
        ? {
            id: l.id,
            title: l.title,
            photo,
            online: l.status === "published",
            sellerPhone: agreed ? l.contact_phone : null,
            sellerName: agreed ? l.contact_name : null,
          }
        : null,
    };
  });
}
