import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { GuidesView, guidesMetadata, readParams, type SP } from "../../guides/GuidesView";

/**
 * /guides?tag=…&page=… — a tag or a page of the guides. The proxy sends those
 * addresses here (src/lib/queryViews.ts), so that /guides itself can come
 * from the CDN; the reader keeps the public address. Read on each request.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<SP> }): Promise<Metadata> {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  return guidesMetadata(locale, readParams(sp));
}

export default async function GuidesQueryPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<SP> }) {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  return <GuidesView locale={locale} view={readParams(sp)} />;
}
