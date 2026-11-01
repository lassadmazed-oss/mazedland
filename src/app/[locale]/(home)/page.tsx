import { getTranslations, setRequestLocale } from "next-intl/server";
import { AdSlot } from "@/components/ads/AdSlot";
import { Link } from "@/i18n/navigation";
import { HomeDesktop } from "@/components/landing/HomeDesktop";
import { HomeRailSection, RailHeading } from "@/components/landing/HomeRail";
import { HomeSearch } from "@/components/landing/HomeSearch";
import { IntentChooser } from "@/components/landing/IntentChooser";
import { HeroPhoto } from "@/components/landing/HeroPhoto";
import { SellBand, WhyBand } from "@/components/landing/HomeBands";
import { LG_UP } from "@/components/ui/HiddenAt";
import { AnnonceCard } from "@/components/listing/AnnonceCard";
import { Impressions } from "@/components/analytics/Impressions";
import { isRtl } from "@/lib/i18n";
import { getHomeFeed } from "@/lib/home/feed";
import { homeRailOptions, planHomeRails, splitAtMiddle, type HomeRail } from "@/lib/home/rails";
import { getSettings } from "@/lib/settings/server";
import { log } from "@/lib/log";
import { PerfProbe } from "@/components/dev/PerfProbe";
import { catalogueHrefForType } from "@/lib/catalog/browse";
import { jsonLdSafe } from "@/lib/jsonld";
import { siteUrl, PRODUCTION_ORIGIN } from "@/lib/siteUrl";
import { organizationLd, pageAlternates, websiteLd } from "@/lib/seo";
import type { Metadata } from "next";
import {
  Building2,
  Home,
  Trees,
  Warehouse,
  Wheat,
  Store,
  Briefcase,
} from "lucide-react";

// Statically render + ISR-revalidate every 60s. The home page is the same
// for everyone (public catalogue); per-user bits (saved hearts, login state)
// are filled in client-side via the watchlist store after hydration. This
// lets Vercel serve the page straight from the edge CDN — ~20ms TTFB and no
// serverless cold start — instead of rendering ~200 cards on every request.
// The rails move in the browser (AutoRail), so they change none of this.
export const revalidate = 60;

/** The home page's own address and its twin (the layout no longer sets one for every page). */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { alternates: pageAlternates(locale, "") };
}

// Home data layer (getHomeFeed + selects + feed types) lives in
// "@/lib/home/feed" so this route file stays render-focused.

/**
 * Race a promise against a deadline. The home page fans out several
 * round-trips to a remote Supabase; if one of them hangs (pooler hiccup,
 * network blip) the whole server render would stall and the route's
 * loading.tsx Suspense fallback would spin forever — the "stuck loading"
 * users hit intermittently. A timeout turns a hang into a fast fallback:
 * the page renders its brand hero + browse rails instead of freezing.
 */
/**
 * How long the data phase may take. Short in development, where a person is
 * watching the spinner; long in production, where the render is a background
 * ISR regeneration and a slow-but-successful query is worth waiting for.
 */
const HOME_DATA_BUDGET_MS = process.env.NODE_ENV === "production" ? 8000 : 2500;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("home_data_timeout")), ms),
    ),
  ]);
}

/**
 * The home page (2026-10-31 redesign).
 *
 * It opens the way the property sites that read as premium open — Rightmove,
 * Idealista, Bayut — on a photograph with one question over it: what are you
 * looking for? The brand photo, the headline, then the search card floating
 * off the photo's lower edge. Everything under it is the catalogue, as rails
 * of the same card the catalogue uses, and the page closes on why to trust
 * the site and the call to publish.
 *
 * Two trees, picked by CSS at the `lg` breakpoint (both are rendered so the
 * page stays static): this file holds the phone's, HomeDesktop the desktop's.
 */
export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  // Required for static rendering with next-intl — must run before any
  // getTranslations/getLocale call, or next-intl falls back to dynamic.
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  const isRTL = isRtl(locale);
  const arabic = isRTL ? "font-arabic" : "";

  // Every rail of annonces, in page order, already cut to what each one
  // shows: « À la une », « Les plus vus », « Nouveautés », « À louer »,
  // « Bonnes affaires », one per type. See src/lib/home/rails.ts for why a
  // rail is there, and when it is not.
  let rails: HomeRail[] = [];
  // « À découvrir »: what no rail shows. (Cast, not annotated: it is set
  // inside the closure below, which TypeScript's narrowing does not follow.)
  let explore = null as HomeRail | null;
  // Always empty / false at static render time — the client favourites store
  // fills in the real saved set + login state post-hydration.
  const savedIds = new Set<string>();
  const loggedIn = false;
  // How many annonces are online: the hero's eyebrow.
  let liveCount = 0;

  // Perf instrumentation — logs to the server terminal under scope `home`.
  const perf = log.scope("home");
  const endData = perf.time("data-phase total");
  try {
    await withTimeout((async () => {
    // Bucketed to the day so the cache key is stable within a day — the
    // "new this week" figure only needs day granularity.
    const weekStart = (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - 7);
      d.setUTCHours(0, 0, 0, 0);
      return d.toISOString();
    })();

    // SHARED public data — cookieless service-role client, cached 60s. No
    // per-user work happens here: the page is statically rendered, so saved
    // hearts + login state are filled client-side after hydration. That is
    // what lets this whole page be CDN-cached instead of rendered per request.
    //
    // Which rails, and how many cards each, are the console's (tab « Accueil »).
    // The layout has already read the settings for this render, so this is
    // React's cache, not another round trip.
    const railOptions = homeRailOptions(await getSettings());
    const endFeed = perf.time("getHomeFeed (hit≈0ms, miss=one round of parallel queries)");
    const feed = await getHomeFeed(weekStart, railOptions);
    endFeed();

    const rows = feed?.published.rows ?? [];
    // eslint-disable-next-line react-hooks/immutability -- synchronising with an external system, which is what an effect is for.
    liveCount = feed?.published.count ?? rows.length;

    // Every rail draws from one inventory, and at a few dozen annonces that made
    // the home page the same cards over and over. The plan has each discovery
    // rail leave out what an earlier one shows, drops any rail left with fewer
    // than three cards, and lets the rails that cut by a criterion (rentals,
    // price per m², one type) keep theirs.
    // The clock is read when the page is built, about once a minute: a
    // placement that has just ended leaves « À la une » on the next build.
    ({ rails, explore } = planHomeRails(feed, railOptions));

    perf.debug("data ready", {
      published: rows.length,
      rails: rails.map((r) => `${r.key}:${r.rows.length}`).join(" "),
      explore: explore?.rows.length ?? 0,
    });
    })(), HOME_DATA_BUDGET_MS);
  } catch (err) {
    perf.warn("data-phase aborted (timeout or error)", err);
    // In production this render is an ISR REGENERATION, and nobody is waiting
    // on it: visitors are being served the previous page while it runs. The
    // fallback below would still render — an empty catalogue, "0 biens" — and
    // Next would then cache THAT for the next 60 seconds, for everyone. One
    // slow Supabase moment was enough to blank the home page site-wide.
    //
    // Throwing instead makes Next keep serving the last good page and retry on
    // the next request. Development keeps the fallback (every request renders
    // there, so a hang is a real wait), and so does `next build`, where a
    // throw would fail a deploy over a transient database hiccup.
    if (process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
      throw err;
    }
  } finally {
    endData();
  }

  // The middle advertising space goes between these two halves, in both layouts.
  const [railsAbove, railsBelow] = splitAtMiddle(rails);
  // The site and the company, for search engines: the search box Google may
  // show under the result, and how to reach Mazed Immo (Réglages → Contact).
  const origin = siteUrl() ?? PRODUCTION_ORIGIN;
  const settings = await getSettings();
  const siteLd = [
    websiteLd(origin, locale, "Mazed Immo"),
    organizationLd(origin, "Mazed Immo", { whatsapp: settings.contact_whatsapp, email: settings.contact_email }),
  ];
  // « 14 annonces en ligne » — or, with nothing online yet, what the site is.
  const eyebrow = liveCount > 0 ? t("home.heroBrandEyebrow", { count: liveCount }) : t("home.heroKicker");

  return (
    <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdSafe(siteLd) }} />
    {/* Client-side perf probe — logs nav/paint/LCP/long-task/resource
        timings to the browser console (scope `perf`). Dev-only unless
        NEXT_PUBLIC_PERF_PROBE=1. Renders nothing. */}
    <PerfProbe tag="home" />
    {/* ════════════════════════════════════════════════════════════════
        MOBILE / TABLET TREE (< lg) — CSS-gated with `lg:hidden`; the
        desktop tree below is `hidden lg:block`. Both are rendered so the
        page stays static (no server-side device detection); CSS picks one.
        ════════════════════════════════════════════════════════════════ */}
    <div className="lg:hidden">
      {/* ───── HERO ─────
          The brand photograph, the headline, and the search card floating
          off its lower edge. The photo is not downloaded at lg+ (HeroPhoto). */}
      <section className="relative overflow-hidden bg-[#1b2a36]" aria-labelledby="home-hero-phone">
        <HeroPhoto hiddenAt={LG_UP} className="absolute inset-0" />
        <div className="mazed-hero-scrim absolute inset-0" aria-hidden />
        <div className="relative px-5 pb-16 pt-9 text-white">
          <p className="inline-flex items-center gap-2 rounded-full bg-black/30 px-3 py-1 text-[11.5px] font-bold ring-1 ring-white/25 backdrop-blur-sm">
            {liveCount > 0 && <span aria-hidden className="size-1.5 rounded-full bg-[var(--accent)]" />}
            {eyebrow}
          </p>
          <h1 id="home-hero-phone" className={`mazed-display mt-3 max-w-[14ch] text-[30px] text-white drop-shadow-sm ${arabic}`}>
            {t("home.heroBrandTitle")}
          </h1>
          <p className={`mt-2.5 max-w-xs text-[14px] font-medium leading-snug text-white/85 ${arabic}`}>{t("brand.slogan")}</p>
        </div>
      </section>

      {/* The search, over the photo's lower edge. `relative z-10` so its
          dropdowns open above the intent row. */}
      <div className="relative z-10 -mt-9 px-4">
        <HomeSearch isRTL={isRTL} layout="hero" />
      </div>

      {/* Sell, buy or rent — the three reasons to be here, one line under the search. */}
      <div className="mt-4 px-4">
        <IntentChooser layout="row" />
      </div>

      {/* An advertiser's banner (/admin/publicites): under the search, above
          the first rail. Nothing when no campaign runs here. */}
      <AdSlot placement="home_top" className="mt-6 px-4" sizes="100vw" />

      {/* ══════════════════════════════════════════════════════════════
          BROWSE — the page's center of gravity: the rails of annonces,
          each moving by itself (AutoRail), each with its « Tout voir ».
          Which rails, in which order, and when one is left out is
          `planHomeRails` — the desktop tree renders the same list.
          ══════════════════════════════════════════════════════════════ */}
      {railsAbove.map((rail) => (
        <HomeRailSection key={rail.key} rail={rail} layout="phone" savedIds={savedIds} loggedIn={loggedIn} />
      ))}

      {/* A second banner, halfway down the rails. */}
      <AdSlot placement="home_middle" className="mt-8 px-4" sizes="100vw" />

      {railsBelow.map((rail) => (
        <HomeRailSection key={rail.key} rail={rail} layout="phone" savedIds={savedIds} loggedIn={loggedIn} />
      ))}

      {/* No rail at all — an empty catalogue, or the data phase timed out in
          development: the shape of a rail, so the page does not open on a gap. */}
      {rails.length === 0 && (
        <section className="mt-10" aria-hidden>
          <div className="hide-scrollbar mt-4 flex gap-3 overflow-x-hidden px-4 pb-2">
            <TrendingSkeleton />
            <TrendingSkeleton />
            <TrendingSkeleton />
          </div>
        </section>
      )}

      {/* Browse by type and by price — chips, in the thumb's rhythm. */}
      <section className="mt-10 px-4" aria-labelledby="home-type-phone">
        <h2 id="home-type-phone" className={`mazed-h2 text-[21px] text-foreground ${arabic}`}>
          {t("home.browseByType")}
        </h2>
        <div className="snap-rail hide-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
          {PROPERTY_TYPES.map((pt) => (
            <Link
              key={pt.key}
              href={catalogueHrefForType(pt.key) as `/annonces`}
              className="tap-target inline-flex shrink-0 snap-start items-center gap-2 rounded-full bg-surface px-4 py-2.5 ring-1 ring-border transition hover:ring-foreground/40 active:scale-[0.97]"
            >
              <pt.Icon className="size-4 text-muted" strokeWidth={2} aria-hidden />
              <span className={`whitespace-nowrap text-[13px] font-bold leading-none text-foreground ${arabic}`}>
                {t(`property.types.${pt.key}`)}
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-7 px-4" aria-labelledby="home-price-phone">
        <h2 id="home-price-phone" className={`mazed-h2 text-[21px] text-foreground ${arabic}`}>
          {t("home.browseByPrice")}
        </h2>
        <div className="snap-rail hide-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
          {PRICE_BUCKETS.map((b) => (
            <Link
              key={b.key}
              href={`/annonces?${b.query}` as `/annonces`}
              className="tap-target inline-flex shrink-0 snap-start items-center justify-center whitespace-nowrap rounded-full bg-surface px-4 py-2.5 text-[13px] font-bold leading-none text-foreground ring-1 ring-border transition hover:ring-foreground/40 active:scale-[0.97]"
            >
              {t(`home.priceBuckets.${b.labelKey}`)}
            </Link>
          ))}
        </div>
      </section>

      {/* « À découvrir » — what no rail above shows, on a 2-up grid. */}
      {explore && (
        <section className="mt-10" aria-labelledby="home-explore-phone">
          <RailHeading
            id="home-explore-phone"
            layout="phone"
            isRTL={isRTL}
            eyebrow={t("home.rails.explore.eyebrow")}
            title={t("home.rails.explore.title")}
            sub={t("home.rails.explore.sub")}
            href={explore.href}
            seeAllLabel={t("home.seeAll")}
          />
          <Impressions ids={explore.rows.map((a) => a.id)} surface="home_explore" />
          <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-5 px-4">
            {explore.rows.map((a) => (
              <AnnonceCard
                key={a.id}
                listing={a}
                saved={savedIds.has(a.id)}
                loggedIn={loggedIn}
                sizes="45vw"
              />
            ))}
          </div>
        </section>
      )}

      {/* Why Mazed Immo, how it works, and the call to publish. */}
      <WhyBand layout="phone" />
      <SellBand layout="phone" />
    </div>

    <HomeDesktop
      railsAbove={railsAbove}
      railsBelow={railsBelow}
      explore={explore}
      savedIds={savedIds}
      loggedIn={loggedIn}
      liveCount={liveCount}
    />
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Browse-by-type / browse-by-price tables.
// ──────────────────────────────────────────────────────────────────────

// Labels come from `property.types.<key>`.
const PROPERTY_TYPES: {
  key: string;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}[] = [
  { key: "apartment",  Icon: Building2 },
  { key: "villa",      Icon: Home },
  { key: "house",      Icon: Home },
  { key: "land",       Icon: Trees },
  // Fermes and Dépôts are categories in the catalogue with chips of their own;
  // the home tiles listed six of the eight, so two were unreachable from here.
  { key: "farm",       Icon: Wheat },
  { key: "commercial", Icon: Store },
  { key: "office",     Icon: Briefcase },
  { key: "warehouse",  Icon: Warehouse },
];

// Labels come from `home.priceBuckets.<labelKey>`.
const PRICE_BUCKETS: {
  key: string;
  labelKey: string;
  /** The params the catalogue reads (`min` / `max` in TND). Sale prices, so
   *  `deal=sale`: « Moins de 100k » listed every rental too otherwise. */
  query: string;
}[] = [
  { key: "under-100k",  labelKey: "under100k",      query: "deal=sale&max=99999" },
  { key: "100k-500k",   labelKey: "from100kTo500k", query: "deal=sale&min=100000&max=499999" },
  { key: "500k-1m",     labelKey: "from500kTo1m",   query: "deal=sale&min=500000&max=999999" },
  { key: "1m-plus",     labelKey: "over1m",         query: "deal=sale&min=1000000" },
];

/**
 * Rail placeholders: the shape of a card, while the catalogue query is in
 * flight or when nothing came back.
 */
function CardSkeleton() {
  return (
    <div className="block">
      <div className="aspect-[4/3] rounded-2xl bg-surface-2" />
      <div className="space-y-2 pt-3">
        <div className="skeleton h-4 w-1/2" />
        <div className="skeleton h-3.5 w-3/4" />
        <div className="skeleton h-3 w-2/3" />
      </div>
    </div>
  );
}

function TrendingSkeleton() {
  return (
    <div className="w-[264px] shrink-0 snap-start">
      <CardSkeleton />
    </div>
  );
}
