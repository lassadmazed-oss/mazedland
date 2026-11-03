import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { ALL_GUIDES, GuidesView, guidesMetadata } from "./GuidesView";

/**
 * /guides, as nearly everyone opens it: every guide, first page. The same for
 * every visitor, so it comes from the CDN and is rebuilt at most a minute
 * after a guide is published. A tag or a page (?tag=, ?page=) is drawn by the
 * twin under /_query (src/lib/queryViews.ts), with the same view.
 */
export const revalidate = 60;
// A build that fails, naming the API, the day something here reads the
// request (headers(), cookies(), searchParams) and silently turns the page
// back into a render on every visit (src/app/[locale]/(home)/page.tsx).
export const dynamic = "error";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return guidesMetadata(locale, ALL_GUIDES);
}

export default async function GuidesPage({ params }: { params: Promise<{ locale: string }> }) {
  // Before any translation: next-intl would otherwise read the request headers.
  const { locale } = await params;
  setRequestLocale(locale);
  return <GuidesView locale={locale} view={ALL_GUIDES} />;
}
