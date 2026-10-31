import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { governorateLabel } from "@/lib/tunisia";
import { delegationLabel } from "@/lib/delegations";
import { absoluteUrl } from "@/lib/siteUrl";
import { AnnonceCard, type AnnonceCardRow } from "@/components/listing/AnnonceCard";
import { Ltr } from "@/components/ui/Ltr";
import { formatTND } from "@/lib/utils";
import { publishedProjects } from "@/lib/pro/projectsServer";
import { deliveryParts, priceFrom, unitCounts } from "@/lib/pro/projects";
import { getSettings } from "@/lib/settings/server";
import { pageNumber } from "@/lib/paging";
import { BadgeCheck, Building2, ChevronLeft, ChevronRight, Clock, Globe, Mail, MapPin, MessageCircle, Phone, Store } from "lucide-react";
import { listingDescription } from "@/lib/seo";

export const dynamic = "force-dynamic";

type Shop = {
  id: string; slug: string; name: string; kind: string; description: string | null; logo_path: string | null; cover_path: string | null;
  governorate: string; city: string | null; phone: string | null; email: string | null; website: string | null; hours: string | null;
  verified_at: string | null; created_at?: string | null;
};

async function loadShop(slug: string): Promise<Shop | null> {
  const admin = getServiceSupabase();
  if (!admin || !/^[a-z0-9-]{3,60}$/.test(slug)) return null;
  const { data } = await admin
    .from("shops")
    .select("id, slug, name, kind, description, logo_path, cover_path, governorate, city, phone, email, website, hours, verified_at, created_at")
    .eq("slug", slug)
    .eq("status", "approved")
    .maybeSingle();
  return (data as Shop | null) ?? null;
}

export async function generateMetadata({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string }> }): Promise<Metadata> {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const shop = await loadShop(slug);
  if (!shop) return {};
  const t = await getTranslations("shops");
  const tKinds = await getTranslations("pro.kinds");
  const locale = await getLocale();
  // « pro immo » alone said nothing in a result: what it is and where.
  const where = shop.governorate ? governorateLabel(shop.governorate, locale) : null;
  // Page 2 and beyond are addresses of their own, as in the catalogue — and a
  // page past the last one is not: it shows page 1 and must not be indexed as
  // a page of its own (the QA tour found ?page=9999 with a canonical).
  const page = pageNumber(sp.page);
  let beyond = false;
  if (page > 1) {
    const admin = getServiceSupabase();
    const { count } = admin
      ? await admin.from("listings").select("id", { count: "exact", head: true }).eq("shop_id", shop.id).eq("status", "published")
      : { count: null };
    const pageSize = (await getSettings()).catalogue_page_size;
    beyond = page > Math.max(1, Math.ceil((count ?? 0) / pageSize));
  }
  const path = `/agences/${shop.slug}${page > 1 && !beyond ? `?page=${page}` : ""}`;
  return {
    title: `${shop.name} — ${tKinds(shop.kind)}${where ? ` · ${where}` : ""} · Mazed Immo`,
    description: listingDescription(shop.description, t("shopMetaDescription", { name: shop.name })),
    ...(beyond ? { robots: { index: false, follow: true } } : {}),
    // With the locale: « /agences/x » redirects, and a canonical must not.
    alternates: {
      canonical: `/${locale}${path}`,
      languages: { fr: `/fr${path}`, ar: `/ar${path}`, "x-default": `/fr${path}` },
    },
    // Shared into WhatsApp or Messenger, the link showed no name and no
    // picture: `openGraph` replaces the layout's block, so the name and the
    // description have to be restated here, with the cover (or the logo).
    openGraph: {
      title: `${shop.name} — ${tKinds(shop.kind)}${where ? ` · ${where}` : ""}`,
      description: listingDescription(shop.description, t("shopMetaDescription", { name: shop.name })),
      type: "website",
      siteName: "Mazed Immo",
      locale: locale === "ar" ? "ar_TN" : "fr_TN",
      url: `/${locale}/agences/${shop.slug}`,
      ...(shop.cover_path || shop.logo_path
        ? { images: [{ url: propertyPhotoUrl((shop.cover_path || shop.logo_path) as string), alt: shop.name }] }
        : {}),
    },
  };
}

const LISTING_SELECT = `
  id, title, price, price_on_request, negotiable, governorate, delegation,
  reference, attributes, deal_type, availability,
  category:categories!listings_category_id_fkey ( label_fr, label_ar ),
  photos:listing_photos ( storage_path, sort_order )
`;

/** wa.me wants the country code; numbers are stored both ways. */
function whatsappLink(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits.length === 8 ? `216${digits}` : digits}`;
}

/**
 * A shop's page (0173): who they are, how to reach them, and their annonces —
 * the same rows as the marketplace, filtered by shop, for sale or for rent,
 * paged like the catalogue. Only an approved shop has a page; « vérifié »
 * shows only when an admin checked their papers.
 *
 * THE LOOK (2026-10-31 redesign), after Bayut's and Property Finder's agency
 * pages: the banner, the logo over its edge, the name with its tick, and the
 * ways to reach the agence as buttons in the header — call, WhatsApp, e-mail,
 * site — then the annonces as the catalogue's own cards.
 */
export default async function ShopPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ deal?: string; page?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const shop = await loadShop(slug);
  if (!shop) notFound();
  const locale = await getLocale();
  const t = await getTranslations("shops");
  const tKinds = await getTranslations("pro.kinds");
  // The pager's words are the catalogue's.
  const tc = await getTranslations("catalogue");
  const tRoot = await getTranslations();
  const settings = await getSettings();
  const admin = getServiceSupabase()!;
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  const tp = await getTranslations("pro.projects");
  const tShopProjects = await getTranslations("shops.projects");
  // The promoter's projects (0179), when they may show (src/lib/pro/projectsServer.ts).
  const projects = await publishedProjects(admin, shop.id);
  const deliveryText = (v: string | null) => {
    const p = deliveryParts(v);
    return !p ? null : p.delivered ? tp("delivery.delivered") : tp("delivery.quarter", { q: String(p.q), year: String(p.year) });
  };

  const deal = sp.deal === "sale" || sp.deal === "rent" ? sp.deal : null;
  // Paged on the catalogue's page size. This was a `.limit(60)` with no pager:
  // an agence on the Business plan has 120 annonces online, and its page
  // showed the first sixty with nothing to say the rest existed, while the
  // directory counted them all. The id is the unique last key — a batch
  // approved together shares its published_at, and without it an annonce
  // could sit on two pages, or on none.
  const pageSize = settings.catalogue_page_size;
  const phoneCols = settings.catalogue_phone_columns === 2 ? "grid-cols-2" : "grid-cols-1";
  let page = pageNumber(sp.page);
  let q = admin.from("listings").select(LISTING_SELECT, { count: "exact" }).eq("shop_id", shop.id).eq("status", "published");
  if (deal) q = q.eq("deal_type", deal);
  q = q.order("published_at", { ascending: false }).order("id", { ascending: true });
  const from = (page - 1) * pageSize;
  let res = await q.range(from, from + pageSize - 1);
  // A page past the end — a stale link, annonces expired since — makes
  // PostgREST refuse the range: the first page, not an empty one.
  if (res.error && page > 1) {
    page = 1;
    res = await q.range(0, pageSize - 1);
  }
  const listings = (res.data ?? []) as unknown as AnnonceCardRow[];
  const total = res.count ?? listings.length;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  // The deal tab and the page in one address; changing the tab returns to page 1.
  const href = (d: "sale" | "rent" | null, p = 1) => {
    const s = new URLSearchParams();
    if (d) s.set("deal", d);
    if (p > 1) s.set("page", String(p));
    return `/agences/${shop.slug}${s.size ? `?${s}` : ""}`;
  };

  const place = `${shop.city ? `${delegationLabel(shop.city, locale)}, ` : ""}${governorateLabel(shop.governorate, locale)}`;
  const since = shop.created_at ? new Date(shop.created_at).getFullYear() : null;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "RealEstateAgent",
    name: shop.name,
    url: absoluteUrl(`/${locale}/agences/${shop.slug}`),
    ...(shop.logo_path ? { logo: absoluteUrl(propertyPhotoUrl(shop.logo_path)) } : {}),
    ...(shop.phone ? { telephone: shop.phone } : {}),
    address: { "@type": "PostalAddress", addressRegion: shop.governorate, ...(shop.city ? { addressLocality: shop.city } : {}), addressCountry: "TN" },
  };

  const action = "tap-target inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-full bg-surface px-4 text-[13px] font-bold text-foreground ring-1 ring-border transition hover:ring-foreground/40 active:scale-[0.98]";

  return (
    <main className="mx-auto max-w-[var(--max-w-wide)] pb-10 lg:px-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />

      {/* The banner — the agence's own, or the mark on warm paper. */}
      <div className="relative aspect-[3/1] max-h-72 w-full overflow-hidden bg-paper-warm-2 lg:mt-4 lg:rounded-[var(--radius-3xl)]">
        {shop.cover_path ? (
          // eslint-disable-next-line @next/next/no-img-element -- the shop's own banner
          <img src={propertyPhotoUrl(shop.cover_path, { transform: { width: 1600, quality: 75 } })} alt="" className="size-full object-cover" />
        ) : (
          <Image
            src="/logo-watermark.webp"
            alt=""
            width={535}
            height={720}
            sizes="320px"
            className="pointer-events-none absolute -bottom-10 end-8 h-[160%] w-auto select-none opacity-[0.18]"
          />
        )}
      </div>

      <div className="px-4 lg:px-2">
        {/* Only the logo rides over the banner's edge; the name sits under it. */}
        <header className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-end gap-4">
            <span className="-mt-10 grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-surface shadow-[var(--shadow-card)] ring-4 ring-[var(--background)] lg:-mt-12 lg:size-24">
              {shop.logo_path ? (
                // eslint-disable-next-line @next/next/no-img-element -- the shop's logo
                <img src={propertyPhotoUrl(shop.logo_path, { transform: { width: 200, quality: 80 } })} alt={shop.name} className="size-full object-cover" />
              ) : (
                <Store className="size-8 text-muted" />
              )}
            </span>
            <div className="min-w-0 pt-3">
              <h1 className="mazed-h2 flex flex-wrap items-center gap-2 text-[24px] text-foreground lg:text-[32px]" dir="auto">
                {shop.name}
                {shop.verified_at && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-foreground px-2.5 py-1 text-[11px] font-bold text-[var(--background)]">
                    <BadgeCheck className="size-3.5" strokeWidth={2.4} aria-hidden /> {t("verified")}
                  </span>
                )}
              </h1>
              <p className="mt-1 text-[13.5px] text-muted">
                {tKinds(shop.kind)} · {place}
                {since ? ` · ${t("memberSince", { year: String(since) })}` : ""}
              </p>
            </div>
          </div>

          {/* How to reach them — the thing a visitor came for, in the header. */}
          {(shop.phone || shop.email || shop.website) && (
            <nav aria-label={t("contactTitle")} className="flex flex-wrap gap-2 lg:justify-end lg:pb-1">
              {shop.phone && (
                <a href={`tel:${shop.phone.replace(/[^\d+]/g, "")}`} className="mazed-btn-luxe tap-target inline-flex h-11 items-center gap-2 px-5 text-[13px]">
                  <Phone className="size-4" strokeWidth={2.4} aria-hidden /> {t("actions.call")}
                </a>
              )}
              {shop.phone && (
                <a href={whatsappLink(shop.phone)} target="_blank" rel="noreferrer" className={action}>
                  <MessageCircle className="size-4 text-[#25D366]" strokeWidth={2.2} aria-hidden /> {t("actions.whatsapp")}
                </a>
              )}
              {shop.email && (
                <a href={`mailto:${shop.email}`} className={action}>
                  <Mail className="size-4 text-muted" strokeWidth={2.2} aria-hidden /> {t("actions.email")}
                </a>
              )}
              {shop.website && (
                <a href={shop.website} target="_blank" rel="noreferrer nofollow" className={action}>
                  <Globe className="size-4 text-muted" strokeWidth={2.2} aria-hidden /> {t("actions.website")}
                </a>
              )}
            </nav>
          )}
        </header>

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-12">
          <div className="min-w-0">
            {projects.length > 0 && (
              <section className="mb-10">
                <h2 className="mazed-h2 text-[20px] text-foreground">{tShopProjects("title")}</h2>
                <ul className="mt-4 grid gap-4 sm:grid-cols-2">
                  {projects.map((p) => {
                    const counts = unitCounts(p.units);
                    const from = priceFrom(p.units);
                    const due = deliveryText(p.delivery);
                    return (
                      <li key={p.id}>
                        <Link
                          href={`/agences/${shop.slug}/projets/${p.slug}` as never}
                          className="group block"
                        >
                          <span className="mazed-photo-frame block aspect-[16/9]">
                            {p.cover_path ? (
                              // eslint-disable-next-line @next/next/no-img-element -- the project's own cover
                              <img src={propertyPhotoUrl(p.cover_path, { transform: { width: 700, quality: 72 } })} alt="" className="size-full object-cover" />
                            ) : (
                              <span className="grid size-full place-items-center"><Building2 className="size-8 text-muted" /></span>
                            )}
                          </span>
                          <span className="block pt-3">
                            <span className="block text-[15px] font-extrabold text-foreground" dir="auto">{p.name}</span>
                            <span className="mt-0.5 block text-[12.5px] text-muted">
                              {tp(`kinds.${p.kind}`)} · {p.delegation ? `${delegationLabel(p.delegation, locale)}, ` : ""}{governorateLabel(p.governorate, locale)}
                              {due ? ` · ${due}` : ""}
                            </span>
                            <span className="mt-1 block text-[13px] font-bold text-foreground">
                              {tShopProjects("available", { count: counts.available })} <span className="font-normal text-muted">{tShopProjects("ofTotal", { total: counts.total })}</span>
                            </span>
                            {from !== null && <span className="block text-[13px] font-bold text-foreground">{tp("priceFrom", { price: `${formatTND(from, locale)} ${tRoot("common.tnd")}` })}</span>}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <nav aria-label={t("deal.all")} className="mazed-segment">
                {([null, "sale", "rent"] as const).map((d) => (
                  <Link key={d ?? "all"} href={href(d) as never} aria-current={deal === d ? "page" : undefined} className="tap-target">
                    {t(`deal.${d ?? "all"}`)}
                  </Link>
                ))}
              </nav>
              {/* The same count the directory's card shows, so the two agree. */}
              <p className="text-[13px] font-bold text-foreground">{t("listingsCount", { count: total })}</p>
            </div>

            {listings.length === 0 ? (
              <p className="mt-5 rounded-3xl border border-dashed border-border px-6 py-12 text-center text-[13.5px] text-muted">{t("noListings")}</p>
            ) : (
              <ul className={`mt-5 grid gap-x-4 gap-y-7 ${phoneCols} sm:grid-cols-2 lg:grid-cols-3`}>
                {listings.map((l, i) => (
                  <li key={l.id}>
                    <AnnonceCard listing={l} loggedIn={!!user} priority={i < 3} sizes="(min-width: 1024px) 300px, (min-width: 640px) 45vw, 92vw" />
                  </li>
                ))}
              </ul>
            )}
            {lastPage > 1 && (
              <nav className="mt-8 flex items-center justify-center gap-2" aria-label={tc("pagination")}>
                {page > 1 ? (
                  <Link
                    href={href(deal, page - 1) as never}
                    className="tap-target inline-flex items-center gap-1 rounded-full bg-surface px-4 py-2 text-[12.5px] font-bold text-foreground ring-1 ring-border transition hover:ring-foreground/40"
                  >
                    <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden /> {tc("previous")}
                  </Link>
                ) : (
                  <span aria-hidden className="w-[108px]" />
                )}
                <span className="mazed-tabular px-2 text-[12.5px] font-semibold text-muted">
                  {page} / {lastPage}
                </span>
                {page < lastPage ? (
                  <Link
                    href={href(deal, page + 1) as never}
                    className="tap-target inline-flex items-center gap-1 rounded-full bg-surface px-4 py-2 text-[12.5px] font-bold text-foreground ring-1 ring-border transition hover:ring-foreground/40"
                  >
                    {tc("next")} <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
                  </Link>
                ) : (
                  <span aria-hidden className="w-[108px]" />
                )}
              </nav>
            )}
          </div>

          {/* Who they are. Under the annonces on a phone, beside them on a desktop. */}
          <aside className="space-y-3">
            {shop.description && (
              <p className="whitespace-pre-line rounded-2xl border border-border bg-surface p-4 text-[13.5px] leading-relaxed text-foreground" dir="auto">
                {shop.description}
              </p>
            )}
            <ul className="space-y-2.5 rounded-2xl border border-border bg-surface p-4 text-[13px]">
              <li className="flex items-center gap-2.5 text-foreground"><MapPin className="size-4 shrink-0 text-muted" aria-hidden /> {place}</li>
              {shop.phone && (
                <li className="flex items-center gap-2.5">
                  <Phone className="size-4 shrink-0 text-muted" aria-hidden />
                  <a href={`tel:${shop.phone.replace(/[^\d+]/g, "")}`} className="font-bold text-foreground hover:underline"><Ltr>{shop.phone}</Ltr></a>
                </li>
              )}
              {shop.email && (
                <li className="flex items-center gap-2.5"><Mail className="size-4 shrink-0 text-muted" aria-hidden /> <a href={`mailto:${shop.email}`} className="truncate text-foreground hover:underline" dir="ltr">{shop.email}</a></li>
              )}
              {shop.website && (
                <li className="flex items-center gap-2.5"><Globe className="size-4 shrink-0 text-muted" aria-hidden /> <a href={shop.website} target="_blank" rel="noreferrer nofollow" className="truncate text-foreground hover:underline" dir="ltr">{shop.website.replace(/^https?:\/\//, "")}</a></li>
              )}
              {shop.hours && <li className="flex items-center gap-2.5 text-foreground"><Clock className="size-4 shrink-0 text-muted" aria-hidden /> <span dir="auto">{shop.hours}</span></li>}
            </ul>
            <p className="px-1 text-[11.5px] leading-snug text-muted">{shop.verified_at ? t("verifiedMeans") : t("notVerifiedMeans")}</p>
          </aside>
        </div>
      </div>
    </main>
  );
}
