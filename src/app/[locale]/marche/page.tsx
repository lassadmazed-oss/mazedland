import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowUpRight, Plus } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings/server";
import { loadMarketStats, shapeMarket, type MarketView } from "@/lib/market/stats";
import { bandLabel, RENT_BANDS, SALE_BANDS } from "@/lib/analytics/shape";
import { governorateLabel, TUNISIAN_GOVERNORATES } from "@/lib/tunisia";
import { formatDate, formatTND } from "@/lib/utils";
import { jsonLdSafe } from "@/lib/jsonld";
import { breadcrumbLd, pageAlternates } from "@/lib/seo";
import { PRODUCTION_ORIGIN, siteUrl } from "@/lib/siteUrl";
import { BarList, Columns } from "@/components/charts/Charts";
import { Card, CountTile, FigureTile, NotEnough, Section, marketFormatters } from "@/components/market/ui";
import { PriceTable } from "@/components/market/PriceTable";
import { GovernorateBlock } from "@/components/market/GovernorateBlock";

// The figures are read from analytics_cache (public_stats_cache_minutes) and
// the switch from the settings, on each request: a page switched off in the
// console answers 404 at once, and a changed sample takes effect at once.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const settings = await getSettings();
  if (!settings.public_stats_enabled) return { robots: { index: false, follow: false } };
  const t = await getTranslations({ locale, namespace: "market" });
  const title = t("metaTitle");
  const description = t("metaDescription");
  return {
    title,
    description,
    alternates: pageAlternates(locale, "/marche"),
    openGraph: {
      type: "website",
      siteName: "Mazed Immo",
      title,
      description,
      url: `/${locale}/marche`,
      images: [{ url: "/og.png", width: 1200, height: 630, alt: title }],
    },
  };
}

/** The structured data: the page, and the dataset it publishes, for search engines. */
function marketLd(view: MarketView, locale: string, origin: string, words: { name: string; description: string; pageTitle: string; pageDescription: string; measured: { name: string; value: number; unit?: string }[] }) {
  const url = `${origin}/${locale}/marche`;
  const datasetId = `${url}#dataset`;
  const from = new Date(Date.parse(view.generatedAt) - view.windowDays * 86_400_000).toISOString().slice(0, 10);
  const to = view.generatedAt.slice(0, 10);
  return [
    {
      "@context": "https://schema.org",
      "@type": "Dataset",
      "@id": datasetId,
      name: words.name,
      description: words.description,
      url,
      inLanguage: locale,
      isAccessibleForFree: true,
      creator: { "@type": "Organization", name: "Mazed Immo", url: origin },
      dateModified: view.generatedAt,
      temporalCoverage: `${from}/${to}`,
      spatialCoverage: { "@type": "Place", name: "Tunisia", address: { "@type": "PostalAddress", addressCountry: "TN" } },
      variableMeasured: words.measured.map((m) => ({ "@type": "PropertyValue", name: m.name, value: m.value, ...(m.unit ? { unitText: m.unit } : {}) })),
    },
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: words.pageTitle,
      description: words.pageDescription,
      url,
      inLanguage: locale,
      dateModified: view.generatedAt,
      isPartOf: { "@type": "WebSite", name: "Mazed Immo", url: `${origin}/${locale}` },
      mainEntity: { "@id": datasetId },
    },
  ];
}

/**
 * « Le marché en chiffres » — the market as the site sees it, for anyone.
 *
 * What is online today, the asking prices (median, per m²) by type and by
 * governorate, how they move, how the supply spreads, what people look for,
 * and one block per governorate under its own anchor. Everything comes from
 * one aggregation (0207) over the annonces published on Mazed Immo and the
 * demand it records; nothing is typed in, and the page recomputes itself.
 * A figure that fewer than `public_stats_min_sample` annonces stand behind
 * is not shown: the page says there is not enough data yet, in its place.
 */
export default async function MarketPage() {
  const locale = await getLocale();
  const settings = await getSettings();
  if (!settings.public_stats_enabled) notFound();
  const t = await getTranslations("market");
  const tc = await getTranslations("common");
  const admin = getServiceSupabase();

  let view: MarketView | null = null;
  if (admin) {
    try {
      const { raw } = await loadMarketStats(admin, { minSample: settings.public_stats_min_sample, cacheMinutes: settings.public_stats_cache_minutes });
      view = shapeMarket(raw, locale);
    } catch {
      view = null;
    }
  }
  if (!view) {
    return (
      <main className="mx-auto max-w-[var(--max-w-wide)] px-4 py-10 lg:px-8">
        <h1 className="mazed-display text-[32px] text-foreground">{t("title")}</h1>
        <p className="mt-4 text-[13.5px] text-muted">{t("unavailable")}</p>
      </main>
    );
  }

  const f = marketFormatters(locale, { tnd: tc("tnd"), perMonth: tc("perMonth"), sqm: tc("sqm") });
  const days = view.windowDays;
  const min = view.minSample;
  const origin = siteUrl() ?? PRODUCTION_ORIGIN;
  const trendLabel = (delta: number | null) => (delta === null ? undefined : t("prices.trend", { delta: f.delta(delta), days }));
  const words = {
    category: t("prices.cols.category"),
    count: t("prices.cols.count"),
    sale: t("prices.cols.sale"),
    rent: t("prices.cols.rent"),
    sqm: t("prices.cols.sqm"),
    basedOn: (n: number) => t("basedOn", { count: n }),
    legend: t("prices.legend", { min }),
    catalogue: t("supply.seeCatalogue"),
  };
  const measured = [
    { name: t("headline.online"), value: view.headline.online },
    { name: t("headline.agences"), value: view.headline.agences },
    { name: t("headline.governorates"), value: view.headline.governorates },
    ...(view.all.sale.median.value !== null ? [{ name: t("prices.medianSale"), value: view.all.sale.median.value, unit: "TND" }] : []),
    ...(view.all.rent.median.value !== null ? [{ name: t("prices.medianRent"), value: view.all.rent.median.value, unit: "TND" }] : []),
  ];
  const ld = [
    breadcrumbLd([
      { name: t("breadcrumbHome"), url: `${origin}/${locale}` },
      { name: t("title"), url: `${origin}/${locale}/marche` },
    ]),
    ...marketLd(view, locale, origin, { name: t("dataset.name"), description: t("dataset.description"), pageTitle: t("metaTitle"), pageDescription: t("metaDescription"), measured }),
  ];
  const withSupply = view.categories.filter((c) => c.online > 0);
  const sale = view.headline.sale;
  const rent = view.headline.rent;
  const total = Math.max(1, sale + rent);
  const demandTiles: { key: "searches" | "visits" | "demandes"; value: number | null }[] = [
    { key: "searches", value: view.demand.searches },
    { key: "visits", value: view.demand.visits },
    { key: "demandes", value: view.demand.demandes },
  ];
  const govName = (gov: string) => governorateLabel(gov, locale);

  return (
    <main className="mx-auto max-w-[var(--max-w-wide)] px-4 py-6 lg:px-8 lg:py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdSafe(ld) }} />

      {/* ── The page's own heading: what this is, when it was computed, the rule it follows. */}
      <header className="max-w-3xl">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-subtle">{t("eyebrow")}</p>
        <h1 className="mazed-display mt-1.5 text-[34px] text-foreground lg:text-[52px]">{t("title")}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted lg:text-[16px]">{t("intro")}</p>
        <p className="mazed-tabular mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-subtle">
          <span>{t("updated", { date: formatDate(view.generatedAt, locale, "medium") })}</span>
          <span aria-hidden>·</span>
          <span>{t("basis", { count: view.headline.online })}</span>
        </p>
        <p className="mt-3 inline-block rounded-xl bg-surface-2 px-3 py-2 text-[12.5px] leading-relaxed text-foreground ring-1 ring-border">{t("rule", { min })}</p>
      </header>

      {/* ── Today: counts, which need no sample to be true. */}
      <section className="mt-8" aria-labelledby="market-today">
        <h2 id="market-today" className="sr-only">{t("headline.title")}</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <CountTile label={t("headline.online")} value={view.headline.online} sub={t("headline.onlineSub", { sale: f.n(sale), rent: f.n(rent) })} f={f} />
          <CountTile
            label={t("headline.new", { days })}
            value={view.headline.new_recent}
            sub={t("headline.newPrev", { count: f.n(view.headline.new_prev), days })}
            delta={view.headline.newDelta}
            deltaLabel={view.headline.newDelta === null ? undefined : t("prices.trend", { delta: f.delta(view.headline.newDelta), days })}
            f={f}
          />
          <CountTile label={t("headline.agences")} value={view.headline.agences} sub={t("headline.agencesSub")} f={f} />
          <CountTile label={t("headline.governorates")} value={view.headline.governorates} sub={t("headline.governoratesSub", { total: TUNISIAN_GOVERNORATES.length })} f={f} />
        </div>
      </section>

      {/* ── Asking prices: the two medians, then by type. */}
      <Section id="prix" title={t("prices.title")} hint={t("prices.hint")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <FigureTile
            big
            label={t("prices.medianSale")}
            figure={view.all.sale.median}
            format={f.money}
            basis={t("basedOn", { count: view.all.sale.median.n })}
            trend={view.all.sale.trend}
            trendLabel={trendLabel(view.all.sale.trend.delta)}
            notEnough={t("notEnough")}
            notEnoughHint={t("notEnoughHint", { min })}
          />
          <FigureTile
            big
            label={t("prices.medianRent")}
            figure={view.all.rent.median}
            format={f.rent}
            basis={t("basedOn", { count: view.all.rent.median.n })}
            trend={view.all.rent.trend}
            trendLabel={trendLabel(view.all.rent.trend.delta)}
            notEnough={t("notEnough")}
            notEnoughHint={t("notEnoughHint", { min })}
          />
        </div>
        {view.all.sale.trend.delta !== null && (
          <p className="mt-2 text-[12px] text-subtle">{t("prices.trendBasis", { recent: f.n(view.all.sale.trend.recent.n), prev: f.n(view.all.sale.trend.prev.n) })}</p>
        )}
        <h3 className="mt-7 text-[15px] font-extrabold text-foreground">{t("prices.byCategory")}</h3>
        <div className="mt-3">
          {view.categories.length > 0 ? <PriceTable rows={view.categories} f={f} words={words} /> : <NotEnough text={t("notEnough")} />}
        </div>
      </Section>

      {/* ── How the asking prices spread, once a deal has the sample. */}
      {(view.bands.sale || view.bands.rent) && (
        <Section id="repartition" title={t("bands.title")}>
          <div className="grid gap-3 lg:grid-cols-2">
            {view.bands.sale && (
              <Card title={t("bands.sale")} hint={t("bands.hintSale")}>
                <Columns
                  label={`${t("bands.title")} · ${t("bands.sale")}`}
                  items={SALE_BANDS.map((b, i) => ({ label: bandLabel("sale", b.band, (n) => formatTND(n, locale)), value: view.bands.sale?.[i] ?? 0 }))}
                  format={f.n}
                />
              </Card>
            )}
            {view.bands.rent && (
              <Card title={t("bands.rent")} hint={t("bands.hintRent")}>
                <Columns
                  label={`${t("bands.title")} · ${t("bands.rent")}`}
                  items={RENT_BANDS.map((b, i) => ({ label: bandLabel("rent", b.band, (n) => formatTND(n, locale)), value: view.bands.rent?.[i] ?? 0 }))}
                  format={f.n}
                />
              </Card>
            )}
          </div>
        </Section>
      )}

      {/* ── The supply: where it is, what it is, sale against rent. */}
      <Section id="offre" title={t("supply.title")}>
        <div className="grid gap-3 lg:grid-cols-2">
          <Card title={t("supply.byGovernorate")}>
            {view.governorates.length > 0 ? (
              <BarList
                items={view.governorates.map((g) => ({
                  label: <a href={`#${g.slug}`} className="font-semibold underline-offset-2 hover:underline">{govName(g.gov)}</a>,
                  value: g.online,
                  sub: `${f.n(g.saleCount)} ${t("supply.forSale")} · ${f.n(g.rentCount)} ${t("supply.forRent")}`,
                }))}
                format={f.n}
              />
            ) : (
              <NotEnough text={t("notEnough")} />
            )}
            <p className="mt-4 text-[12px] text-subtle">{t("supply.more")}</p>
          </Card>
          <Card title={t("supply.byCategory")}>
            {withSupply.length > 0 ? (
              <BarList
                items={withSupply.map((c) => ({
                  label: <Link href={`/annonces?cat=${encodeURIComponent(c.slug)}` as never} className="font-semibold underline-offset-2 hover:underline">{c.label}</Link>,
                  value: c.online,
                  sub: `${f.n(c.sale.n)} ${t("supply.forSale")} · ${f.n(c.rent.n)} ${t("supply.forRent")}`,
                }))}
                format={f.n}
              />
            ) : (
              <NotEnough text={t("notEnough")} />
            )}
          </Card>
        </div>
        <Card title={t("supply.split")} className="mt-3">
          <div className="flex h-3 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${f.n(sale)} ${t("supply.forSale")} · ${f.n(rent)} ${t("supply.forRent")}`}>
            <span className="block h-full bg-foreground" style={{ width: `${(sale / total) * 100}%` }} />
            <span className="block h-full bg-foreground opacity-35" style={{ width: `${(rent / total) * 100}%` }} />
          </div>
          <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-muted">
            <li className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-foreground" aria-hidden /><span className="mazed-tabular font-bold text-foreground">{f.n(sale)}</span> {t("supply.forSale")}</li>
            <li className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-foreground opacity-35" aria-hidden /><span className="mazed-tabular font-bold text-foreground">{f.n(rent)}</span> {t("supply.forRent")}</li>
          </ul>
        </Card>
      </Section>

      {/* ── The demand: totals of the last window, never a person, never an annonce. */}
      <Section id="demande" title={t("demand.title")} hint={t("demand.hint", { days })}>
        {view.demand.any ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              {demandTiles.map((d) => (
                <FigureTile
                  key={d.key}
                  label={t(`demand.${d.key}`)}
                  figure={{ value: d.value, n: 0 }}
                  format={f.n}
                  basis={t(`demand.${d.key}Sub`)}
                  notEnough={t("notEnough")}
                  notEnoughHint={t("notEnoughHint", { min })}
                />
              ))}
            </div>
            {view.demand.byGovernorate.length > 0 && (
              <Card title={t("demand.byGovernorate")} className="mt-3">
                <ul className="divide-y divide-border">
                  {view.demand.byGovernorate.map((d) => (
                    <li key={d.gov} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-[13px]">
                      <a href={`#${d.slug}`} className="font-bold text-foreground underline-offset-2 hover:underline">{govName(d.gov)}</a>
                      <span className="mazed-tabular text-muted">
                        {[
                          d.searches !== null ? t("demand.searchesIn", { count: d.searches }) : null,
                          d.visits !== null ? t("demand.visitsIn", { count: d.visits }) : null,
                          d.demandes !== null ? t("demand.demandesIn", { count: d.demandes }) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </>
        ) : (
          <NotEnough text={t("notEnough")} hint={t("notEnoughHint", { min })} />
        )}
      </Section>

      {/* ── Governorate by governorate, each under its anchor. */}
      <Section id="gouvernorats" title={t("governorates.title")} hint={t("governorates.hint")}>
        {view.governorates.length === 0 ? (
          <NotEnough text={t("notEnough")} />
        ) : (
          <>
            <nav aria-label={t("governorates.jump")} className="flex flex-wrap gap-1.5">
              {view.governorates.map((g) => (
                <a
                  key={g.slug}
                  href={`#${g.slug}`}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full bg-surface px-3 text-[12px] font-bold text-foreground ring-1 ring-border transition hover:ring-foreground/40"
                >
                  {govName(g.gov)} <span className="mazed-tabular text-muted">{f.n(g.online)}</span>
                </a>
              ))}
            </nav>
            <div className="mt-5 space-y-4">
              {view.governorates.map((g) => (
                <GovernorateBlock key={g.slug} g={g} f={f} locale={locale} days={days} min={min} />
              ))}
            </div>
          </>
        )}
      </Section>

      {/* ── Where it all comes from, and the way in. */}
      <section className="mazed-band-warm mt-12 rounded-[var(--radius-3xl)] p-6 lg:mt-16 lg:p-10" aria-labelledby="market-method">
        <h2 id="market-method" className="mazed-h2 text-[22px] text-foreground lg:text-[28px]">{t("method.title")}</h2>
        <p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-muted">{t("method.body", { min })}</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[15px] font-bold text-foreground">{t("method.cta")}</p>
          <Link href={"/annonces/nouvelle" as never} className="mazed-btn-luxe tap-target inline-flex h-12 shrink-0 items-center gap-2 rounded-full px-6 text-[14px]">
            <Plus className="size-4" strokeWidth={2.5} aria-hidden />
            {t("method.ctaButton")}
          </Link>
        </div>
        <Link href={"/annonces" as never} className="mt-5 inline-flex items-center gap-1 text-[13px] font-bold text-foreground underline-offset-2 hover:underline">
          {t("supply.seeCatalogue")} <ArrowUpRight className="size-3.5 rtl:-scale-x-100" strokeWidth={2.4} aria-hidden />
        </Link>
      </section>
    </main>
  );
}
