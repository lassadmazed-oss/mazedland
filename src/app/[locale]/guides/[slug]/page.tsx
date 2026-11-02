import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getSettings } from "@/lib/settings/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { loadGuide, publishedGuides } from "@/lib/guides/server";
import { ctaFor, relatedGuides, shownText, type Article } from "@/lib/guides/articles";
import { outline, parseMarkdown, plainText, readingMinutes } from "@/lib/guides/markdown";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { absoluteUrl, siteUrl, PRODUCTION_ORIGIN } from "@/lib/siteUrl";
import { jsonLdSafe } from "@/lib/jsonld";
import { articleLd, breadcrumbLd, clip } from "@/lib/seo";
import { formatDate } from "@/lib/utils";
import { MarkdownBody } from "@/components/guides/Markdown";
import { Toc } from "@/components/guides/Toc";
import { GuideCard } from "@/components/guides/GuideCard";
import { GuideCta } from "@/components/guides/GuideCta";
import { TrackEvent } from "@/components/analytics/TrackEvent";
import { CalendarDays, ChevronRight, Clock, Languages, PencilLine } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * One guide (0208).
 *
 * The cover, the title, when it was written and how long it takes to read,
 * then the text — Markdown read by the site's own renderer, so nothing
 * written in the console is ever HTML on this page — with its table of
 * contents in a column that follows the reader on a desktop. It closes on the
 * guides that go with it and on the way to the catalogue, or to the publish
 * form when the guide is for sellers.
 *
 * A guide written in one language only is shown in that language on the
 * other locale's page, with a note at the top and `noindex`: the reader gets
 * the text, Google is not told the Arabic page is Arabic. A draft is shown to
 * a signed-in admin only, with a banner, so it can be proofread at its real
 * address before « Publier ».
 */

const OG_LOCALE: Record<string, string> = { fr: "fr_TN", ar: "ar_TN" };

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

/** The guide a visitor may read at this address, or null (not found). */
async function visible(slug: string): Promise<{ article: Article; preview: boolean } | null> {
  const article = await loadGuide(slug);
  if (!article) return null;
  if (article.status === "published") return { article, preview: false };
  return (await viewerIsAdmin()) ? { article, preview: true } : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string; locale: string }> }): Promise<Metadata> {
  const { slug, locale } = await params;
  const t = await getTranslations({ locale, namespace: "guides" });
  const found = await visible(slug);
  const shown = found ? shownText(found.article, locale) : null;
  if (!found || !shown) return { title: t("notFound"), robots: { index: false } };
  const { article, preview } = found;
  const path = `/guides/${article.slug}`;
  const url = `/${locale}${path}`;
  const title = shown.seoTitle ?? shown.title;
  const description = shown.seoDescription ?? shown.excerpt ?? clip(plainText(parseMarkdown(shown.body)), 160);
  const image = article.cover_path ? propertyPhotoUrl(article.cover_path) : null;
  return {
    title: `${title} · Mazed Immo`,
    description,
    alternates: {
      canonical: url,
      languages: {
        ...Object.fromEntries(routing.locales.map((lc) => [lc, `/${lc}${path}`])),
        "x-default": `/${routing.defaultLocale}${path}`,
      },
    },
    // A draft, or a page whose language the guide does not have yet, stays out of the index.
    ...(preview || shown.missing ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      type: "article",
      siteName: "Mazed Immo",
      locale: OG_LOCALE[locale],
      url,
      title,
      description,
      ...(article.published_at ? { publishedTime: article.published_at } : {}),
      modifiedTime: article.updated_at,
      ...(image ? { images: [{ url: image, width: 1600, height: 900, alt: shown.title }] } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string; locale: string }> }) {
  const { slug } = await params;
  const settings = await getSettings();
  if (!settings.guides_enabled) notFound();
  const found = await visible(slug);
  if (!found) notFound();
  const { article, preview } = found;
  const locale = await getLocale();
  const t = await getTranslations("guides");
  const shown = shownText(article, locale);
  if (!shown) notFound();

  const blocks = parseMarkdown(shown.body);
  const headings = outline(blocks).filter((h) => h.level <= 3);
  const minutes = readingMinutes(plainText(blocks));
  const withToc = settings.guides_toc_min > 0 && headings.length >= settings.guides_toc_min;
  const related = relatedGuides(await publishedGuides(), article, settings.guides_related_count);
  const published = article.published_at ? formatDate(article.published_at, locale, "long") : null;
  // « Mis à jour » only when the text moved a while after it went online.
  const updated =
    article.published_at && Date.parse(article.updated_at) - Date.parse(article.published_at) > 2 * 86_400_000
      ? formatDate(article.updated_at, locale, "long")
      : null;
  const arabic = shown.lang === "ar" ? "font-arabic" : "";
  const origin = siteUrl() ?? PRODUCTION_ORIGIN;
  const url = absoluteUrl(`/${locale}/guides/${article.slug}`);
  const cover = article.cover_path ? propertyPhotoUrl(article.cover_path) : null;
  const description = shown.seoDescription ?? shown.excerpt ?? clip(plainText(blocks), 160);

  return (
    <main className="mx-auto max-w-[var(--max-w-wide)] px-4 pb-10 pt-4 lg:px-8 lg:pb-16 lg:pt-8">
      {!preview && (
        <script
          type="application/ld+json"
          // jsonLdSafe: the title and the snippet are an editor's words, kept out of the script's way.
          dangerouslySetInnerHTML={{
            __html: jsonLdSafe(
              articleLd({
                url,
                headline: shown.title,
                description,
                image: cover,
                datePublished: article.published_at ?? article.created_at,
                dateModified: article.updated_at,
                inLanguage: shown.lang,
                publisher: "Mazed Immo",
                origin,
              }),
            ),
          }}
        />
      )}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdSafe(
            breadcrumbLd([
              { name: t("breadcrumbHome"), url: absoluteUrl(`/${locale}`) },
              { name: t("title"), url: absoluteUrl(`/${locale}/guides`) },
              { name: shown.title, url },
            ]),
          ),
        }}
      />
      <TrackEvent name="guide_view" params={{ slug: article.slug, lang: shown.lang, tags: article.tags }} />

      {preview && (
        <p className="mb-4 flex items-center gap-2 rounded-2xl bg-amber-500/15 px-4 py-2.5 text-[12.5px] font-bold text-amber-800 ring-1 ring-amber-500/30">
          <PencilLine className="size-4" aria-hidden /> {t("draftBanner")}
        </p>
      )}

      <nav aria-label={t("breadcrumb")} className="flex items-center gap-1 text-[12.5px] text-muted">
        <Link href="/" className="shrink-0 hover:text-foreground">
          {t("breadcrumbHome")}
        </Link>
        <ChevronRight className="size-3.5 shrink-0 rtl:-scale-x-100" aria-hidden />
        <Link href={"/guides" as never} className="shrink-0 hover:text-foreground">
          {t("title")}
        </Link>
        <ChevronRight className="size-3.5 shrink-0 rtl:-scale-x-100" aria-hidden />
        <span dir="auto" className="truncate font-semibold text-foreground">
          {shown.title}
        </span>
      </nav>

      <article className="mt-5 lg:mt-8">
        <header className="mx-auto max-w-3xl">
          {article.tags.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {article.tags.map((tag) => (
                <li key={tag}>
                  <Link
                    href={`/guides?tag=${tag}` as never}
                    className="inline-flex h-7 items-center rounded-full bg-surface-2 px-2.5 text-[11.5px] font-bold text-foreground ring-1 ring-border transition hover:ring-foreground/40"
                  >
                    {t(`tags.${tag}`)}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <h1 lang={shown.lang} dir={shown.lang === "ar" ? "rtl" : "ltr"} className={`mazed-display mt-4 break-words text-[30px] text-foreground lg:text-[44px] ${arabic}`}>
            {shown.title}
          </h1>
          <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
            {published && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="size-3.5" aria-hidden /> {t("publishedOn", { date: published })}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-3.5" aria-hidden /> {t("readMinutes", { minutes })}
            </span>
            {updated && <span>{t("updatedOn", { date: updated })}</span>}
          </p>
          {shown.missing && (
            <p className="mazed-band-warm mt-4 flex items-start gap-2 rounded-2xl px-4 py-3 text-[13px] leading-relaxed text-foreground/85 ring-1 ring-border">
              <Languages className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{t(`otherLanguage.${shown.lang}`)}</span>
            </p>
          )}
        </header>

        {cover && (
          <div className="mazed-photo-frame mx-auto mt-6 aspect-[16/9] max-w-5xl rounded-[var(--radius-3xl)] lg:mt-8">
            <Image src={cover} alt="" fill priority sizes="(min-width: 1024px) 1024px, 100vw" className="object-cover" />
          </div>
        )}

        <div className={`mx-auto mt-8 ${withToc ? "lg:grid lg:max-w-5xl lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start lg:gap-12" : "max-w-3xl"}`}>
          <div className="min-w-0 lg:max-w-3xl">
            {withToc && (
              <details className="mb-6 rounded-2xl bg-surface ring-1 ring-border lg:hidden">
                <summary className="cursor-pointer list-none px-4 py-3 text-[13px] font-bold text-foreground">{t("toc")}</summary>
                <div className="px-4 pb-4">
                  <Toc headings={headings} title={t("toc")} lang={shown.lang} />
                </div>
              </details>
            )}
            {shown.excerpt && (
              <p lang={shown.lang} dir={shown.lang === "ar" ? "rtl" : "ltr"} className={`text-[18px] font-semibold leading-relaxed text-foreground/80 ${arabic}`}>
                {shown.excerpt}
              </p>
            )}
            <MarkdownBody blocks={blocks} lang={shown.lang} className={shown.excerpt ? "mt-6" : ""} />
          </div>
          {withToc && (
            <aside className="hidden lg:block">
              <div className="sticky top-[calc(var(--desktop-nav-h)+1.5rem)] rounded-2xl bg-surface p-5 ring-1 ring-border">
                <Toc headings={headings} title={t("toc")} lang={shown.lang} />
              </div>
            </aside>
          )}
        </div>
      </article>

      {related.length > 0 && (
        <section className="mazed-section" aria-labelledby="guides-related">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-subtle">{t("related.eyebrow")}</p>
          <h2 id="guides-related" className="mazed-h2 mt-1 text-[22px] text-foreground lg:text-[26px]">
            {t("related.title")}
          </h2>
          <ul className={`mt-5 grid gap-x-5 gap-y-8 sm:grid-cols-2 ${related.length >= 3 ? "lg:grid-cols-3" : ""}`}>
            {related.map((g) => (
              <li key={g.id}>
                <GuideCard guide={g} via="related" />
              </li>
            ))}
          </ul>
        </section>
      )}

      <GuideCta kind={ctaFor(article.tags)} />
    </main>
  );
}
