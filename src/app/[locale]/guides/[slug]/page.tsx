import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { GuideView, guideMetadata, visibleGuide } from "./GuideView";

/**
 * One published guide, the same for every reader: it comes from the CDN, built
 * the first time it is asked for and again at most a minute after it changes.
 * A draft is not found here; the console opens it with ?apercu, which the
 * proxy sends to the twin under /_query that knows who is asking.
 */
export const revalidate = 60;
// A build that fails, naming the API, the day something here reads the
// request (headers(), cookies(), searchParams) and silently turns the page
// back into a render on every visit (src/app/[locale]/(home)/page.tsx).
export const dynamic = "error";
// Guides published after the build are built on their first visit.
export const dynamicParams = true;

export async function generateMetadata({ params }: { params: Promise<{ slug: string; locale: string }> }): Promise<Metadata> {
  const { slug, locale } = await params;
  return guideMetadata(locale, await visibleGuide(slug));
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string; locale: string }> }) {
  // Before any translation: next-intl would otherwise read the request headers.
  const { slug, locale } = await params;
  setRequestLocale(locale);
  return <GuideView locale={locale} found={await visibleGuide(slug)} />;
}
