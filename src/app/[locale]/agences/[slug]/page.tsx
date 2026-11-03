import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { ALL_LISTINGS, ShopView, shopMetadata } from "./ShopView";

/**
 * An agence's page as nearly everyone opens it: all its annonces, first page.
 * The same for every visitor, so it comes from the CDN — built the first time
 * it is asked for, again at most a minute after a change, and at once when
 * the agence saves its page (src/lib/revalidatePublic.ts). A deal or a page
 * (?deal=, ?page=) is drawn by the twin under /_query (src/lib/queryViews.ts).
 */
export const revalidate = 60;
// A build that fails, naming the API, the day something here reads the
// request (headers(), cookies(), searchParams) and silently turns the page
// back into a render on every visit (src/app/[locale]/(home)/page.tsx).
export const dynamic = "error";
// Agences opened after the build are built on their first visit.
export const dynamicParams = true;

export async function generateMetadata({ params }: { params: Promise<{ slug: string; locale: string }> }): Promise<Metadata> {
  const { slug, locale } = await params;
  return shopMetadata(slug, locale, ALL_LISTINGS);
}

export default async function ShopPage({ params }: { params: Promise<{ slug: string; locale: string }> }) {
  // Before any translation: next-intl would otherwise read the request headers.
  const { slug, locale } = await params;
  setRequestLocale(locale);
  return <ShopView slug={slug} locale={locale} view={ALL_LISTINGS} />;
}
