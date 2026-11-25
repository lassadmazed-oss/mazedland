import { getServiceSupabase } from "@/lib/supabase/admin";
import { loadSettings } from "@/lib/settings/server";
import { siteUrl } from "@/lib/siteUrl";
import { buildLlmsTxt } from "@/lib/llms";
import { log } from "@/lib/log";

/**
 * GET /llms.txt — the site described for answer engines (src/lib/llms.ts),
 * from the day's published annonces. Rebuilt at most once a day: it is read by
 * machines, and its figures move slowly.
 */
export const revalidate = 86400;

export async function GET() {
  const origin = siteUrl() ?? "https://www.mazed.immo";
  const sb = getServiceSupabase();
  const settings = await loadSettings(sb);
  const listings: { deal: string | null; cat: string | null; gov: string | null }[] = [];
  const categories: Record<string, string> = {};
  let agencies = 0;
  let guides: { slug: string; title: string }[] = [];
  if (sb) {
    try {
      // Page by page: the API hands out 1 000 rows a request.
      for (let from = 0; from < 50_000; from += 1000) {
        const { data, error } = await sb
          .from("listings")
          .select("deal_type, governorate, category:categories (slug)")
          .eq("status", "published")
          .order("id")
          .range(from, from + 999);
        if (error) throw error;
        for (const r of (data ?? []) as unknown as { deal_type: string | null; governorate: string | null; category: { slug: string } | { slug: string }[] | null }[]) {
          const cat = Array.isArray(r.category) ? r.category[0]?.slug ?? null : r.category?.slug ?? null;
          listings.push({ deal: r.deal_type, gov: r.governorate, cat });
        }
        if (!data || data.length < 1000) break;
      }
      const [{ data: cats }, { count }, guideRows] = await Promise.all([
        sb.from("categories").select("slug, label_fr").eq("is_active", true).not("parent_id", "is", null),
        sb.from("shops").select("id", { count: "exact", head: true }).eq("status", "approved"),
        settings.guides_enabled
          ? sb.from("articles").select("slug, title_fr").eq("status", "published").order("published_at", { ascending: false }).limit(50)
          : Promise.resolve({ data: [] }),
      ]);
      for (const c of (cats ?? []) as { slug: string; label_fr: string }[]) categories[c.slug] = c.label_fr;
      agencies = count ?? 0;
      guides = ((guideRows.data ?? []) as { slug: string; title_fr: string | null }[])
        .filter((g) => g.title_fr)
        .map((g) => ({ slug: g.slug, title: g.title_fr as string }));
    } catch (e) {
      log.scope("llms").error("read failed", { msg: e instanceof Error ? e.message : String(e) });
    }
  }
  const body = buildLlmsTxt({
    origin,
    listings,
    categories,
    agencies,
    guides,
    marketPage: settings.public_stats_enabled,
    demandsPage: settings.feature_requests && settings.requests_board,
    whatsapp: settings.contact_whatsapp,
    email: settings.contact_email,
  });
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
