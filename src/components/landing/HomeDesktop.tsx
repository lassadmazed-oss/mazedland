import { getTranslations, getLocale } from "next-intl/server";
import { AdSlot } from "@/components/ads/AdSlot";
import { Link } from "@/i18n/navigation";
import { BELOW_LG } from "@/components/ui/HiddenAt";
import { HomeRailSection } from "@/components/landing/HomeRail";
import { HomeSearch } from "@/components/landing/HomeSearch";
import { IntentChooser } from "@/components/landing/IntentChooser";
import { HeroPhoto } from "@/components/landing/HeroPhoto";
import { SellBand, WhyBand } from "@/components/landing/HomeBands";
import { isRtl } from "@/lib/i18n";
import type { HomeRail } from "@/lib/home/rails";
import { catalogueHrefForType } from "@/lib/catalog/browse";
import { ArrowUpRight, ChevronRight, ChevronLeft, ShieldCheck, Lock, Scale } from "lucide-react";

/**
 * Desktop (lg+) home surface, kept in its own file so the mobile tree in the
 * route's page.tsx is never touched. Rendered behind `hidden lg:block`, so it
 * costs nothing on phones.
 *
 * The 2026-10-31 redesign: a full-width photographic hero with the headline,
 * the search card floating off its lower edge, the three intents and the
 * three trust points on one line under it; then the rails (the same list as
 * the phone's, each an auto-sliding carousel with arrows), the type tiles and
 * price shortcuts, and the two closing bands.
 */

// Labels come from i18n (`property.types.<key>`); the tile art is a
// pre-optimized illustration at /icons/<key>.{avif,webp}.
// `icon` names the file in /public/icons: the set has six, and the two
// categories added here borrow the closest one rather than ship a broken tile.
const PROPERTY_TYPES: { key: string; icon: string }[] = [
  { key: "apartment",  icon: "apartment" },
  { key: "villa",      icon: "villa" },
  { key: "house",      icon: "house" },
  { key: "land",       icon: "land" },
  { key: "farm",       icon: "land" },
  { key: "commercial", icon: "commercial" },
  { key: "office",     icon: "office" },
  { key: "warehouse",  icon: "commercial" },
];

// Labels come from `home.priceBuckets.<labelKey>`. Sale prices: without
// `deal=sale`, « Moins de 100k » listed every rental too — a month's rent is
// always under 100 000.
const PRICE_BUCKETS: { key: string; labelKey: string; query: string }[] = [
  { key: "under-100k", labelKey: "under100k",      query: "deal=sale&max=99999" },
  { key: "100k-500k",  labelKey: "from100kTo500k", query: "deal=sale&min=100000&max=499999" },
  { key: "500k-1m",    labelKey: "from500kTo1m",   query: "deal=sale&min=500000&max=999999" },
  { key: "1m-plus",    labelKey: "over1m",         query: "deal=sale&min=1000000" },
];

export async function HomeDesktop({
  railsAbove,
  railsBelow,
  explore,
  savedIds,
  loggedIn,
  liveCount,
  alwaysVisible = false,
}: {
  /** The rails of annonces (`planHomeRails`), on either side of the middle
   *  advertising space. */
  railsAbove: HomeRail[];
  railsBelow: HomeRail[];
  /** « À découvrir », or null when nothing is left for it. */
  explore: HomeRail | null;
  savedIds: Set<string>;
  loggedIn: boolean;
  /** How many annonces are online: the hero's eyebrow. */
  liveCount: number;
  /** When true the root drops its `hidden lg:block` gate and renders at
   *  all widths — set by the home page when it has already decided (via
   *  UA) to send only the desktop tree. */
  alwaysVisible?: boolean;
}) {
  const t = await getTranslations();
  const locale = await getLocale();
  const isRTL = isRtl(locale);
  const arabic = isRTL ? "font-arabic" : "";
  const ChevronEnd = isRTL ? ChevronLeft : ChevronRight;
  const eyebrow = liveCount > 0 ? t("home.heroBrandEyebrow", { count: liveCount }) : t("home.heroKicker");

  // What the product actually promises, on one quiet line under the search.
  const trust = [
    { key: "verified", Icon: ShieldCheck, title: t("home.verifiedTitle") },
    { key: "number",   Icon: Lock,        title: t("home.protectedNumberTitle") },
    { key: "nofee",    Icon: Scale,       title: t("home.trustLegalTitle") },
  ];

  return (
    <div className={`${alwaysVisible ? "block" : "hidden lg:block"} mx-auto max-w-[var(--max-w-wide)] px-8 pb-4`}>
      {/* ─── HERO — the photograph, the headline, the search ─── */}
      <section
        className="relative mt-5 overflow-hidden rounded-[var(--radius-3xl)] bg-[#1b2a36]"
        aria-labelledby="home-hero-desktop"
      >
        <HeroPhoto hiddenAt={alwaysVisible ? "not all" : BELOW_LG} className="absolute inset-0" />
        <div className="mazed-hero-scrim absolute inset-0" aria-hidden />
        <div className="relative px-12 pb-24 pt-16 text-white xl:px-16 xl:pt-20">
          <p className="inline-flex items-center gap-2 rounded-full bg-black/30 px-3.5 py-1.5 text-[12px] font-bold ring-1 ring-white/25 backdrop-blur-sm">
            {liveCount > 0 && <span aria-hidden className="size-1.5 rounded-full bg-[var(--accent)]" />}
            {eyebrow}
          </p>
          <h1
            id="home-hero-desktop"
            className={`mazed-display mt-5 max-w-[15ch] text-[clamp(40px,4.4vw,60px)] text-white drop-shadow-sm ${arabic}`}
          >
            {t("home.heroBrandTitle")}
          </h1>
          <p className={`mt-4 max-w-md text-[17px] font-medium leading-snug text-white/85 ${arabic}`}>{t("brand.slogan")}</p>
        </div>
      </section>

      {/* The search card, over the photo's lower edge. `relative z-10` so its
          dropdowns open above what follows. */}
      <div className="relative z-10 -mt-12 px-8 xl:px-12">
        <HomeSearch isRTL={isRTL} layout="hero" />
      </div>

      {/* The three intents, and what the site promises, on one line. */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-x-8 gap-y-3 px-8 xl:px-12">
        <IntentChooser layout="row" />
        <ul className="flex flex-wrap items-center gap-x-5 gap-y-1">
          {trust.map((it) => (
            <li key={it.key} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-muted">
              <it.Icon className="size-4 text-foreground" strokeWidth={2} aria-hidden />
              {it.title}
            </li>
          ))}
        </ul>
      </div>

      {/* The hero is the intent and the search; an advertiser's banner
          (/admin/publicites) under it, above the first rail. */}
      <AdSlot placement="home_top" className="mt-12" sizes="(min-width: 1280px) 1200px, 100vw" />

      {/* THE RAILS — the phone page's list (`planHomeRails`), each one an
          auto-sliding carousel with arrows. */}
      {railsAbove.map((rail) => (
        <HomeRailSection key={rail.key} rail={rail} layout="desktop" savedIds={savedIds} loggedIn={loggedIn} />
      ))}

      {/* A second banner, halfway down the rails. */}
      <AdSlot placement="home_middle" className="mt-14" sizes="(min-width: 1280px) 1200px, 100vw" />

      {railsBelow.map((rail) => (
        <HomeRailSection key={rail.key} rail={rail} layout="desktop" savedIds={savedIds} loggedIn={loggedIn} />
      ))}

      {/* PARCOURIR — category tiles (one row) + price pills */}
      <section className="mazed-section" aria-labelledby="home-browse-desktop">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-subtle">{t("home.browseEyebrow")}</p>
            <h2 id="home-browse-desktop" className={`mazed-h2 mt-1.5 text-[24px] text-foreground ${arabic}`}>
              {t("home.browseTitle")}
            </h2>
          </div>
          <Link
            href="/annonces"
            className="inline-flex shrink-0 items-center gap-0.5 rounded-full px-2 text-[13px] font-bold text-foreground underline-offset-4 transition hover:underline"
          >
            {t("home.seeAll")}
            <ChevronEnd className="size-4" strokeWidth={2.4} aria-hidden />
          </Link>
        </div>

        {/* Type — eight tiles across one row. */}
        <div className="mt-6 grid grid-cols-4 gap-3 xl:grid-cols-8">
          {PROPERTY_TYPES.map((pt) => (
            <Link
              key={pt.key}
              href={catalogueHrefForType(pt.key) as `/annonces`}
              className="group flex flex-col items-center gap-2 rounded-2xl bg-surface px-3 py-5 ring-1 ring-border transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)] hover:ring-foreground/30"
            >
              <picture>
                <source srcSet={`/icons/${pt.icon}.avif`} type="image/avif" />
                <source srcSet={`/icons/${pt.icon}.webp`} type="image/webp" />
                <img
                  src={`/icons/${pt.icon}.webp`}
                  alt=""
                  width={64}
                  height={64}
                  loading="lazy"
                  decoding="async"
                  className="size-14 transition-transform duration-300 group-hover:scale-105"
                />
              </picture>
              <span className={`text-[13px] font-bold text-foreground ${arabic}`}>{t(`property.types.${pt.key}`)}</span>
            </Link>
          ))}
        </div>

        {/* Price — four pills across one row. */}
        <div className="mt-3 grid grid-cols-4 gap-3">
          {PRICE_BUCKETS.map((b) => (
            <Link
              key={b.key}
              href={`/annonces?${b.query}` as `/annonces`}
              className="group flex items-center justify-between rounded-2xl bg-surface px-5 py-3.5 ring-1 ring-border transition hover:ring-foreground/30"
            >
              <span className="text-[13.5px] font-bold text-foreground">{t(`home.priceBuckets.${b.labelKey}`)}</span>
              <ArrowUpRight className="size-4 text-subtle transition group-hover:text-foreground rtl:-scale-x-100" strokeWidth={2.2} aria-hidden />
            </Link>
          ))}
        </div>
      </section>

      {/* MORE TO EXPLORE — what no rail above shows, auto-sliding too */}
      {explore && <HomeRailSection rail={explore} layout="desktop" savedIds={savedIds} loggedIn={loggedIn} />}

      {/* Why Mazed Immo, how it works, and the call to publish. */}
      <WhyBand layout="desktop" />
      <SellBand layout="desktop" />
    </div>
  );
}
