import type { getServiceSupabase } from "@/lib/supabase/admin";

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

/**
 * « Agences recommandées » — the strip above the catalogue (owner, 2026-10-31,
 * after reading how Tayara sells « Boutique recommandée »). Nobody picks the
 * agences: an agence is in it while its plan runs and is big enough
 * (`agency_strip_min_quota`), whether it paid for it or the console offered
 * it, and while it has an annonce online. The order turns each day, so the
 * first place goes round instead of staying with the same agence.
 */
export type FeaturedShop = {
  id: string;
  slug: string;
  name: string;
  logoPath: string | null;
  verified: boolean;
  city: string | null;
  governorate: string;
  listings: number;
};

/** A small stable hash (FNV-1a): the same text always gives the same number. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The agences in the order of `seed` (a day, a place): the same all day, another tomorrow. */
export function orderFeatured<T extends { id: string }>(rows: readonly T[], seed: string): T[] {
  return rows
    .map((r) => ({ r, k: hash(`${seed}:${r.id}`) }))
    .sort((a, b) => a.k - b.k || a.r.id.localeCompare(b.r.id))
    .map((x) => x.r);
}

/** The UTC day of `now`, « 2026-11-02 ». */
export const dayKey = (now: Date) => now.toISOString().slice(0, 10);

export async function loadFeaturedShops(
  admin: Admin,
  opts: { minQuota: number; max: number; governorate?: string | null; now?: Date },
): Promise<FeaturedShop[]> {
  const now = opts.now ?? new Date();
  const iso = now.toISOString();
  // A strip is a nicety: any failure leaves the page without it.
  try {
    const { data: periods } = await admin
      .from("shop_subscriptions")
      .select("shop_id")
      .eq("status", "active")
      .lte("starts_at", iso)
      .gt("ends_at", iso)
      .gte("listing_quota", opts.minQuota);
    const ids = [...new Set(((periods ?? []) as { shop_id: string }[]).map((p) => p.shop_id))];
    if (ids.length === 0) return [];

    let q = admin
      .from("shops")
      .select("id, slug, name, logo_path, governorate, city, verified_at")
      .eq("status", "approved")
      .in("id", ids);
    if (opts.governorate) q = q.eq("governorate", opts.governorate);
    const { data: shops } = await q;
    const open = (shops ?? []) as {
      id: string; slug: string; name: string; logo_path: string | null; governorate: string; city: string | null; verified_at: string | null;
    }[];
    if (open.length === 0) return [];

    const { data: rows } = await admin
      .from("listings")
      .select("shop_id")
      .eq("status", "published")
      .in("shop_id", open.map((s) => s.id));
    const counts = new Map<string, number>();
    for (const r of (rows ?? []) as { shop_id: string }[]) counts.set(r.shop_id, (counts.get(r.shop_id) ?? 0) + 1);

    const shown = open
      .filter((s) => (counts.get(s.id) ?? 0) > 0)
      .map((s) => ({
        id: s.id,
        slug: s.slug,
        name: s.name,
        logoPath: s.logo_path,
        verified: !!s.verified_at,
        city: s.city,
        governorate: s.governorate,
        listings: counts.get(s.id) ?? 0,
      }));
    return orderFeatured(shown, `${dayKey(now)}:${opts.governorate ?? ""}`).slice(0, Math.max(1, opts.max));
  } catch {
    return [];
  }
}
