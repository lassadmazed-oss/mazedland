import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { ShopView, readShopQuery, shopMetadata } from "../../../agences/[slug]/ShopView";

type SP = { deal?: string; page?: string };

/**
 * /agences/<slug>?deal=…&page=… — the agence's annonces for sale or for rent,
 * or a page past the first. The proxy sends those addresses here
 * (src/lib/queryViews.ts), so that the agence's page itself can come from the
 * CDN; the reader keeps the public address. Read on each request.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params, searchParams }: { params: Promise<{ slug: string; locale: string }>; searchParams: Promise<SP> }): Promise<Metadata> {
  const [{ slug, locale }, sp] = await Promise.all([params, searchParams]);
  return shopMetadata(slug, locale, readShopQuery(sp));
}

export default async function ShopQueryPage({ params, searchParams }: { params: Promise<{ slug: string; locale: string }>; searchParams: Promise<SP> }) {
  const [{ slug, locale }, sp] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  return <ShopView slug={slug} locale={locale} view={readShopQuery(sp)} />;
}
