import type { getServiceSupabase } from "@/lib/supabase/admin";
import { offerPlanPeriod } from "./shops";

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

/**
 * The founding agencies' places (the owner, 2026-10-31: the first 10 agences
 * get 3 months of the Pro plan for nothing). A place is taken the day the
 * console gives an agence its free period (« Offrir une période »), and stays
 * taken when the period ends. So the count on the Pro page is real — the
 * scarcity it shows is the one the console enforces by hand.
 */
export type FoundingSeats = { total: number; taken: number; left: number };

export function seatsOf(taken: number, total: number): FoundingSeats {
  const t = Math.max(0, Math.floor(total));
  const n = Math.max(0, Math.floor(taken));
  return { total: t, taken: Math.min(n, t), left: Math.max(0, t - n) };
}

/** A plan the founding offer lets an agence pick at sign-up. */
export type FoundingPlan = {
  slug: string;
  name_fr: string;
  name_ar: string | null;
  price: number;
  quota: number;
};

/**
 * The plans an agence may pick, in the order of `choices` with duplicates
 * gone, and only those on sale with a quota (a slug the console mistyped or
 * took off sale is skipped, not offered).
 */
export function foundingPlansOf(
  products: readonly { slug: string; name_fr: string; name_ar: string | null; price: number | string; listing_quota: number | null }[],
  choices: readonly string[],
): FoundingPlan[] {
  const out: FoundingPlan[] = [];
  for (const slug of new Set(choices.map((c) => c.trim().toLowerCase()).filter(Boolean))) {
    const p = products.find((x) => x.slug === slug);
    const quota = Number(p?.listing_quota);
    if (!p || !(Number.isFinite(quota) && quota > 0)) continue;
    out.push({ slug: p.slug, name_fr: p.name_fr, name_ar: p.name_ar, price: Number(p.price), quota });
  }
  return out;
}

/** What « Ouvrir » gives: the plan the agence picked at sign-up, else the offer's own. */
export function foundingPlanFor(picked: string | null | undefined, offerPlan: string): string {
  return picked?.trim() ? picked.trim() : offerPlan;
}

/**
 * The founding offer as the sign-up form shows it (2026-11-03, the owner: no
 * payment for the first 50 agences, and « الوكالة تختار » between 40 and 120
 * annonces): open while `feature_founding_auto` is on and a place is left,
 * with the plans to pick from. Null otherwise — the form then asks for a paid
 * plan, as before. The place itself is taken when the console opens the agence.
 */
export async function foundingSignup(
  admin: Admin,
  s: { feature_founding_auto: boolean; founding_seats: number; founding_offer_months: number; founding_offer_choices: readonly string[] },
): Promise<{ seats: FoundingSeats; months: number; plans: FoundingPlan[] } | null> {
  if (!s.feature_founding_auto || s.founding_offer_choices.length === 0) return null;
  const seats = await loadFoundingSeats(admin, s.founding_seats);
  if (seats.left <= 0) return null;
  const { data } = await admin
    .from("products")
    .select("slug, name_fr, name_ar, price, listing_quota")
    .eq("kind", "subscription")
    .eq("is_active", true);
  const plans = foundingPlansOf((data ?? []) as Parameters<typeof foundingPlansOf>[0], s.founding_offer_choices);
  return plans.length > 0 ? { seats, months: s.founding_offer_months, plans } : null;
}

/** The agences that were given a period for nothing (no payment behind it), counted once each. */
export async function loadFoundingSeats(admin: Admin, total: number): Promise<FoundingSeats> {
  // A counter is a nicety: any failure leaves the page without it (0 places left shows nothing).
  try {
    const { data } = await admin
      .from("shop_subscriptions")
      .select("shop_id")
      .is("payment_id", null)
      .not("granted_by", "is", null)
      .neq("status", "cancelled")
      .limit(2000);
    const shops = new Set(((data ?? []) as { shop_id: string }[]).map((r) => r.shop_id));
    return seatsOf(shops.size, total);
  } catch {
    return seatsOf(total, total);
  }
}

/**
 * The founding offer, given on its own (the owner, 2026-11-01: « the first 50
 * agences, and one that opens its agence goes straight in with the offer, with
 * no payment step »). When the console opens an agence that has no plan, and
 * the offer is on and has places left, the agence is given its free months of
 * the offer's plan right there — the same period « Offrir une période » makes
 * (no payment, no invoice, once per agence), so the place count, the reminder
 * before it ends and the console's journal all see it.
 *
 * Null when there is nothing to give: the offer is off, no place is left, the
 * plan is not on sale, or the agence has already had its period (then it pays).
 */
export async function foundingOffer(
  admin: Admin,
  opts: {
    shopId: string;
    grantedBy: string;
    enabled: boolean;
    seats: number;
    months: number;
    planSlug: string;
  },
  now: Date = new Date(),
): Promise<{ plan: string; months: number; until: string } | null> {
  if (!opts.enabled) return null;
  if ((await loadFoundingSeats(admin, opts.seats)).left <= 0) return null;
  const { data: product } = await admin
    .from("products")
    .select("id, name_fr, listing_quota")
    .eq("slug", opts.planSlug)
    .eq("kind", "subscription")
    .eq("is_active", true)
    .maybeSingle();
  const quota = Number(product?.listing_quota);
  if (!product || !(Number.isFinite(quota) && quota > 0)) return null;
  const period = await offerPlanPeriod(
    admin,
    { shopId: opts.shopId, productId: product.id as string, quota, months: opts.months, grantedBy: opts.grantedBy },
    now,
  );
  if ("error" in period || "already" in period) return null;
  return { plan: product.name_fr as string, months: opts.months, until: period.endsAt.toISOString() };
}
