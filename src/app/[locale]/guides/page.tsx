import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getSettings } from "@/lib/settings/server";
import { publishedGuides, tagCounts } from "@/lib/guides/server";
import { ARTICLE_TAGS, isArticleTag, type ArticleTag } from "@/lib/guides/articles";
import { pageNumber } from "@/lib/paging";
import { absoluteUrl } from "@/lib/siteUrl";
import { jsonLdSafe } from "@/lib/jsonld";
import { breadcrumbLd, itemListLd, pageAlternates } from "@/lib/seo";
import { GuideCard } from "@/components/guides/GuideCard";
import { BookOpen, ChevronLeft, ChevronRight } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * /guides — the guides and practical information (0208): how to buy step by
 * step, which papers to check, what the notary costs, how a rent contract
 * works… written in the console, published in French and Arabic.
 *
 * Cards in a grid, a row of tag chips to narrow them, pages of
 * `guides_per_page`. Everything is a link: no JavaScript is needed to filter
 * or turn a page, and a filtered view is an address one can send.
 */

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function readParams(sp: SP): { tag: ArticleTag | null; page: number } {
  const tag = first(sp.tag);
  return { tag: isArticleTag(tag) ? tag : null, page: pageNumber(first(sp.page)) };
}

function query(tag: ArticleTag | null, page: number): string {
  const q = new URLSearchParams();
  if (tag) q.set("tag", tag);
  if (page > 1) q.set("page", String(page));
  return q.toString();
}

export async function generateMetadata({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<SP> }): Promise<Metadata> {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  const { tag, page } = readParams(sp);
  const [t, settings, all] = await Promise.all([getTranslations({ locale, namespace: "guides" }), getSettings(), publishedGuides()]);
  const total = tag ? all.filter((g) => g.tags.includes(tag)).length : all.length;
  const beyond = page > Math.max(1, Math.ceil(total / settings.guides_per_page));
  return {
    // The brand by hand, as the annonce and agence pages do: the locale
    // layout's absolute title leaves the root template behind.
    title: `${tag ? t("metaTitleTag", { tag: t(`tags.${tag}`) }) : t("metaTitle")} · Mazed Immo`,
    description: t("metaDescription"),
    alternates: pageAlternates(locale, "/guides", beyond ? query(tag, 1) : query(tag, page)),
    ...(beyond ? { robots: { index: false, follow: true } } : {}),
  };
}

function chip(on: boolean): string {
  return `inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[12.5px] font-bold transition ${
    on ? "bg-foreground text-[var(--background)]" : "bg-surface text-foreground ring-1 ring-border hover:ring-foreground/40"
  }`;
}

export default async function GuidesPage({ searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<SP> }) {
  const settings = await getSettings();
  if (!settings.guides_enabled) notFound();
  const sp = await searchParams;
  const { tag, page } = readParams(sp);
  const [t, locale, all] = await Promise.all([getTranslations("guides"), getLocale(), publishedGuides()]);

  const counts = tagCounts(all);
  const list = tag ? all.filter((g) => g.tags.includes(tag)) : all;
  const perPage = settings.guides_per_page;
  const lastPage = Math.max(1, Math.ceil(list.length / perPage));
  const current = Math.min(page, lastPage);
  const rows = list.slice((current - 1) * perPage, current * perPage);
  const tags = ARTICLE_TAGS.filter((x) => (counts.get(x) ?? 0) > 0);
  const href = (nextTag: ArticleTag | null, nextPage: number) => {
    const q = query(nextTag, nextPage);
    return (q ? `/guides?${q}` : "/guides") as never;
  };
  const home = absoluteUrl(`/${locale}`);

  return (
    <main className="mx-auto max-w-[var(--max-w-wide)] px-4 pb-10 pt-4 lg:px-8 lg:pb-16 lg:pt-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdSafe(
            breadcrumbLd([
              { name: t("breadcrumbHome"), url: home },
              { name: t("title"), url: absoluteUrl(`/${locale}/guides`) },
            ]),
          ),
        }}
      />
      {rows.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdSafe(itemListLd(rows.map((g) => absoluteUrl(`/${locale}/guides/${g.slug}`)))) }}
        />
      )}

      <nav aria-label={t("breadcrumb")} className="flex items-center gap-1 text-[12.5px] text-muted">
        <Link href="/" className="hover:text-foreground">
          {t("breadcrumbHome")}
        </Link>
        <ChevronRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
        <span className="font-semibold text-foreground">{t("title")}</span>
      </nav>

      <header className="mazed-band-warm mt-4 rounded-[var(--radius-3xl)] px-5 py-8 lg:px-10 lg:py-12">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-subtle">{t("eyebrow")}</p>
        <h1 className="mazed-display mt-2 text-[30px] text-foreground lg:text-[44px]">{t("title")}</h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted lg:text-[16px]">{t("intro")}</p>
      </header>

      {tags.length > 0 && (
        <nav aria-label={t("tagFilterLabel")} className="hide-scrollbar -mx-4 mt-6 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:flex-wrap lg:px-0">
          <Link href={href(null, 1)} className={chip(tag === null)} aria-current={tag === null ? "page" : undefined}>
            {t("allTags")} <span className="mazed-tabular opacity-70">{all.length}</span>
          </Link>
          {tags.map((x) => (
            <Link key={x} href={href(x, 1)} className={chip(tag === x)} aria-current={tag === x ? "page" : undefined}>
              {t(`tags.${x}`)} <span className="mazed-tabular opacity-70">{counts.get(x)}</span>
            </Link>
          ))}
        </nav>
      )}

      {rows.length === 0 ? (
        <div className="mt-8 rounded-3xl border border-dashed border-border bg-surface-2/40 px-6 py-14 text-center">
          <span className="inline-grid size-12 place-items-center rounded-full bg-surface text-muted ring-1 ring-border">
            <BookOpen className="size-5" aria-hidden />
          </span>
          <p className="mt-4 text-[15px] font-extrabold text-foreground">{t("emptyTitle")}</p>
          <p className="mt-1 text-[13px] text-muted">{t("emptyBody")}</p>
          {tag && (
            <Link href={href(null, 1)} className="tap-target mt-5 inline-flex items-center rounded-full bg-foreground px-4 py-2 text-[12.5px] font-bold text-[var(--background)]">
              {t("allTags")}
            </Link>
          )}
        </div>
      ) : (
        <ul className="mt-8 grid gap-x-5 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((g, i) => (
            <li key={g.id}>
              <GuideCard guide={g} via="index" priority={i < 3} />
            </li>
          ))}
        </ul>
      )}

      {lastPage > 1 && (
        <nav className="mt-10 flex items-center justify-center gap-2" aria-label={t("pagination")}>
          {current > 1 ? (
            <Link
              href={href(tag, current - 1)}
              className="tap-target inline-flex items-center gap-1 rounded-full bg-surface px-4 py-2 text-[12.5px] font-bold text-foreground ring-1 ring-border transition hover:ring-foreground/40"
            >
              <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden /> {t("previous")}
            </Link>
          ) : (
            <span aria-hidden className="w-[108px]" />
          )}
          <span className="mazed-tabular px-2 text-[12.5px] font-semibold text-muted">
            {current} / {lastPage}
          </span>
          {current < lastPage ? (
            <Link
              href={href(tag, current + 1)}
              className="tap-target inline-flex items-center gap-1 rounded-full bg-surface px-4 py-2 text-[12.5px] font-bold text-foreground ring-1 ring-border transition hover:ring-foreground/40"
            >
              {t("next")} <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
            </Link>
          ) : (
            <span aria-hidden className="w-[108px]" />
          )}
        </nav>
      )}
    </main>
  );
}
