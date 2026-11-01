import type { getServiceSupabase } from "@/lib/supabase/admin";

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
