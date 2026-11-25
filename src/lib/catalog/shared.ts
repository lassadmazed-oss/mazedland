/**
 * What the catalogue (/annonces) reads besides its results, kept between
 * requests (2026-11-25, the speed plan). Each search paid these one after
 * another before showing anything: the categories (twice, with the page's
 * title), every published annonce's governorate to list the places, the
 * délégations of the chosen one, the four queries of « Agences recommandées ».
 * None of them changes from one search to the next.
 *
 * Each lives a few minutes at most; a category saved in the console drops its
 * copy at once (CATEGORIES_TAG). A failed read is never kept — it throws
 * inside the cache and the request reads on its own.
 */
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { loadFeaturedShops, type FeaturedShop } from "@/lib/pro/featured";
import type { ReactiveRules } from "@/lib/pro/reactivity";

export type CatalogueCategory = {
  id: string;
  slug: string;
  label_fr: string;
  label_ar: string | null;
  kind: string;
  parent_id: string | null;
  is_active: boolean;
};

/** Cleared by the console's catalogue editor (/api/admin/catalogue). */
export const CATEGORIES_TAG = "catalogue-categories";

function db() {
  const admin = getServiceSupabase();
  if (!admin) throw new Error("catalogue: no database client");
  return admin;
}

/** A shared copy, or this request's own read when there is none (a script, a test, a failed read). */
function shared<A extends unknown[], T>(read: (...args: A) => Promise<T>, key: string, revalidate: number, tags: string[] = []) {
  const kept = unstable_cache(read, [key], { revalidate, tags });
  return async (...args: A): Promise<T> => {
    try {
      return await kept(...args);
    } catch {
      return read(...args);
    }
  };
}

const PAGE = 1000;

/** Every value of one column over the published annonces, past PostgREST's 1 000-row page. */
async function publishedColumn(column: "governorate" | "delegation", governorate?: string): Promise<string[]> {
  const admin = db();
  const out = new Set<string>();
  for (let from = 0; from < 50 * PAGE; from += PAGE) {
    let q = admin.from("listings").select(column).eq("status", "published");
    if (governorate) q = q.eq("governorate", governorate).not("delegation", "is", null);
    const { data, error } = await q.order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as Record<string, string | null>[]) if (r[column]) out.add(r[column] as string);
    if (!data || data.length < PAGE) break;
  }
  return [...out].sort();
}

const sharedCategories = shared(
  async (): Promise<CatalogueCategory[]> => {
    const { data, error } = await db()
      .from("categories")
      .select("id, slug, label_fr, label_ar, kind, parent_id, is_active")
      .order("sort_order");
    if (error) throw new Error(error.message);
    return (data ?? []) as CatalogueCategory[];
  },
  "catalogue-categories-v1",
  300,
  [CATEGORIES_TAG],
);

/** Every category, active or not, in the console's order — once per request, from the shared copy. */
export const catalogueCategories = cache(async (): Promise<CatalogueCategory[]> => {
  try {
    return await sharedCategories();
  } catch {
    return [];
  }
});

const sharedGovernorates = shared(() => publishedColumn("governorate"), "catalogue-governorates-v1", 300);

/** The governorates that have an annonce online, sorted. */
export const publishedGovernorates = cache(async (): Promise<string[]> => {
  try {
    return await sharedGovernorates();
  } catch {
    return [];
  }
});

const sharedDelegations = shared((gov: string) => publishedColumn("delegation", gov), "catalogue-delegations-v1", 300);

/** The délégations of one governorate that have an annonce online, as stored. */
export const publishedDelegations = cache(async (governorate: string): Promise<string[]> => {
  try {
    return await sharedDelegations(governorate);
  } catch {
    return [];
  }
});

type FeaturedOpts = {
  minQuota: number;
  max: number;
  governorate: string | null;
  reactive: { rules: ReactiveRules; first: boolean } | null;
};

// The strip's order turns once a day (orderFeatured): two minutes of the same list changes nothing.
const sharedFeatured = shared(async (opts: FeaturedOpts): Promise<FeaturedShop[]> => loadFeaturedShops(db(), opts), "catalogue-featured-v1", 120);

/** « Agences recommandées » for these rules (src/lib/pro/featured.ts), from the shared copy. */
export async function featuredShops(opts: FeaturedOpts): Promise<FeaturedShop[]> {
  try {
    return await sharedFeatured(opts);
  } catch {
    return [];
  }
}

type CountFilter = { deal: string | null; categoryId: string | null; governorate: string | null; delegation: string | null };

const sharedCount = shared(
  async (f: CountFilter): Promise<number> => {
    let c = db().from("listings").select("id", { count: "exact", head: true }).eq("status", "published");
    if (f.deal) c = c.eq("deal_type", f.deal);
    if (f.categoryId) c = c.eq("category_id", f.categoryId);
    if (f.governorate) c = c.eq("governorate", f.governorate);
    if (f.delegation) c = c.eq("delegation", f.delegation);
    const { count, error } = await c;
    if (error || count === null) throw new Error(error?.message ?? "count: none");
    return count;
  },
  "catalogue-landing-count-v1",
  120,
);

/**
 * How many annonces a landing page holds — the number in its description and
 * the « past the last page » check, which Next waits for before the first byte
 * of /annonces (htmlLimitedBots). Two minutes old at most; null when unknown.
 */
export async function landingCount(f: CountFilter): Promise<number | null> {
  try {
    return await sharedCount(f);
  } catch {
    return null;
  }
}
