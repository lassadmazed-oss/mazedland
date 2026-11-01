/**
 * The guides as the pages read them (0208), through the service role: the
 * public pages, the footer's link and the strips beside annonces all share
 * one request-scoped list of what is published.
 */
import { cache } from "react";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { log } from "@/lib/log";
import type { Article, ArticleSummary } from "./articles";

const gLog = log.scope("guides");

export const SUMMARY_SELECT =
  "id, slug, status, published_at, updated_at, cover_path, title_fr, title_ar, excerpt_fr, excerpt_ar, tags";

/** Every published guide, newest first — at most a couple of hundred, read once per request. */
export const publishedGuides = cache(async (): Promise<ArticleSummary[]> => {
  const admin = getServiceSupabase();
  if (!admin) return [];
  const { data, error } = await admin
    .from("articles")
    .select(SUMMARY_SELECT)
    .eq("status", "published")
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(200);
  if (error) {
    gLog.error("published guides query failed", { msg: error.message });
    return [];
  }
  return (data ?? []) as ArticleSummary[];
});

/** One guide by its address, whatever its status: the page decides who may see a draft. */
export const loadGuide = cache(async (slug: string): Promise<Article | null> => {
  const admin = getServiceSupabase();
  if (!admin || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) return null;
  const { data, error } = await admin.from("articles").select("*").eq("slug", slug).maybeSingle();
  if (error) {
    gLog.error("guide query failed", { slug, msg: error.message });
    return null;
  }
  return (data as Article | null) ?? null;
});

/** The tag filter of /guides, with how many guides each tag holds. */
export function tagCounts(guides: readonly ArticleSummary[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const g of guides) for (const t of g.tags) out.set(t, (out.get(t) ?? 0) + 1);
  return out;
}
