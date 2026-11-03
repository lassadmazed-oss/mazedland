import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { GuideView, guideMetadata, visibleGuide } from "../../../guides/[slug]/GuideView";

/**
 * /guides/<slug>?apercu — the console's link to a guide. The proxy sends it
 * here (src/lib/queryViews.ts) because the public page is static, from the
 * CDN, and cannot know who is reading: here, on each request, a signed-in
 * admin sees a draft with its banner, and the text as it was just saved.
 * Anyone else sees what the public page shows.
 */
export const dynamic = "force-dynamic";

/** Whether the request comes from a console member (a draft's only readers). */
async function viewerIsAdmin(): Promise<boolean> {
  try {
    const sb = await getServerSupabase();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return false;
    const admin = getServiceSupabase();
    if (!admin) return false;
    const { data } = await admin.from("profiles").select("role, banned_at").eq("id", user.id).maybeSingle();
    return data?.role === "admin" && !data.banned_at;
  } catch {
    return false;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string; locale: string }> }): Promise<Metadata> {
  const { slug, locale } = await params;
  return guideMetadata(locale, await visibleGuide(slug, viewerIsAdmin));
}

export default async function GuidePreviewPage({ params }: { params: Promise<{ slug: string; locale: string }> }) {
  const { slug, locale } = await params;
  setRequestLocale(locale);
  return <GuideView locale={locale} found={await visibleGuide(slug, viewerIsAdmin)} />;
}
