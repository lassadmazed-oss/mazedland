import { getTranslations, setRequestLocale } from "next-intl/server";
import { AdSlot } from "@/components/ads/AdSlot";
import { Link } from "@/i18n/navigation";
import { HomeRailSection } from "@/components/landing/HomeRail";
import { HomeSearch } from "@/components/landing/HomeSearch";
import { IntentChooser } from "@/components/landing/IntentChooser";
import { HeroPhoto } from "@/components/landing/HeroPhoto";
import { SellBand, WhyBand } from "@/components/landing/HomeBands";
import { GuidesStrip } from "@/components/guides/GuidesStrip";
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
  ArrowUpRight,
  Building2,
  ChevronLeft,
  ChevronRight,
  Home,
  Lock,
  Scale,
  ShieldCheck,
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
// And a build that fails, naming the API, the day something in this tree reads
// the request (headers(), cookies(), searchParams): Next would otherwise render
// the page on every visit without a word. From 2026-10-30 to 2026-11-03 the
// root not-found's headers() did exactly that — home 0.6–1.7 s instead of the
// CDN (src/app/not-found.tsx).
export const dynamic = "error";

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
 * One tree for the phone and the desktop: what differs at the `lg`
 * breakpoint is CSS, so the page stays static (no device detection on the
 * server) and a phone builds and hydrates only what it shows.
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

  // The middle advertising space goes between these two halves.
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

  // What the product actually promises, on one quiet line beside the intents (lg up).
  const trust = [
    { key: "verified", Icon: ShieldCheck, title: t("home.verifiedTitle") },
    { key: "number",   Icon: Lock,        title: t("home.protectedNumberTitle") },
    { key: "nofee",    Icon: Scale,       title: t("home.trustLegalTitle") },
  ];
  const ChevronEnd = isRTL ? ChevronLeft : ChevronRight;

  return (
    <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdSafe(siteLd) }} />
    {/* Client-side perf probe — logs nav/paint/LCP/long-task/resource
        timings to the browser console (scope `perf`). Dev-only unless
        NEXT_PUBLIC_PERF_PROBE=1. Renders nothing. */}
    <PerfProbe tag="home" />
    {/* ONE TREE for every width. Until 2026-11-03 the phone got its own copy
        of the page (`lg:hidden`) and the desktop another (`hidden lg:block`):
        CSS showed one, but a phone downloaded, parsed and hydrated both — five
        thousand elements and every card twice. Edge to edge on a phone; from
        lg up, a centred column with the hero and the bands rounded. */}
    <div className="mx-auto max-w-[var(--max-w-wide)] lg:px-8 lg:pb-4">
      {/* ───── HERO ─────
          The brand photograph, the headline, and the search card floating
          off its lower edge. */}
      <section
        className="relative overflow-hidden bg-[#1b2a36] lg:mt-5 lg:rounded-[var(--radius-3xl)]"
        aria-labelledby="home-hero"
      >
        <HeroPhoto className="absolute inset-0" />
        <div className="mazed-hero-scrim absolute inset-0" aria-hidden />
        <div className="relative px-5 pb-16 pt-9 text-white lg:px-12 lg:pb-24 lg:pt-16 xl:px-16 xl:pt-20">
          <p className="inline-flex items-center gap-2 rounded-full bg-black/30 px-3 py-1 text-[11.5px] font-bold ring-1 ring-white/25 backdrop-blur-sm lg:px-3.5 lg:py-1.5 lg:text-[12px]">
            {liveCount > 0 && <span aria-hidden className="size-1.5 rounded-full bg-[var(--accent)]" />}
            {eyebrow}
          </p>
          <h1
            id="home-hero"
            className={`mazed-display mt-3 max-w-[14ch] text-[30px] text-white drop-shadow-sm lg:mt-5 lg:max-w-[15ch] lg:text-[clamp(40px,4.4vw,60px)] ${arabic}`}
          >
            {t("home.heroBrandTitle")}
          </h1>
          <p className={`mt-2.5 max-w-xs text-[14px] font-medium leading-snug text-white/85 lg:mt-4 lg:max-w-md lg:text-[17px] ${arabic}`}>
            {t("brand.slogan")}
          </p>
        </div>
      </section>

      {/* The search, over the photo's lower edge. `relative z-10` so its
          dropdowns open above what follows. */}
      <div className="relative z-10 -mt-9 px-4 lg:-mt-12 lg:px-8 xl:px-12">
        <HomeSearch isRTL={isRTL} layout="hero" />
      </div>

      {/* Sell, buy or rent — the three reasons to be here, one line under the
          search; from lg up, what the site promises at the end of that line. */}
      <div className="mt-4 px-4 lg:mt-5 lg:flex lg:flex-wrap lg:items-center lg:justify-between lg:gap-x-8 lg:gap-y-3 lg:px-8 xl:px-12">
        <IntentChooser layout="row" />
        <ul className="hidden flex-wrap items-center gap-x-5 gap-y-1 lg:flex">
          {trust.map((it) => (
            <li key={it.key} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-muted">
              <it.Icon className="size-4 text-foreground" strokeWidth={2} aria-hidden />
              {it.title}
            </li>
          ))}
        </ul>
      </div>

      {/* An advertiser's banner (/admin/publicites): under the search, above
          the first rail. Nothing when no campaign runs here. */}
      <AdSlot placement="home_top" className="mt-6 px-4 lg:mt-12 lg:px-0" sizes="(min-width: 1280px) 1200px, 100vw" />

      {/* ══════════════════════════════════════════════════════════════
          BROWSE — the page's center of gravity: the rails of annonces,
          each moving by itself (AutoRail), each with its « Tout voir ».
          Which rails, in which order, and when one is left out is
          `planHomeRails`.
          ══════════════════════════════════════════════════════════════ */}
      {railsAbove.map((rail) => (
        <HomeRailSection key={rail.key} rail={rail} savedIds={savedIds} loggedIn={loggedIn} />
      ))}

      {/* A second banner, halfway down the rails. */}
      <AdSlot placement="home_middle" className="mt-8 px-4 lg:mt-14 lg:px-0" sizes="(min-width: 1280px) 1200px, 100vw" />

      {railsBelow.map((rail) => (
        <HomeRailSection key={rail.key} rail={rail} savedIds={savedIds} loggedIn={loggedIn} />
      ))}

      {/* No rail at all — an empty catalogue, or the data phase timed out in
          development: the shape of a rail, so the phone does not open on a gap. */}
      {rails.length === 0 && (
        <section className="mt-10 lg:hidden" aria-hidden>
          <div className="hide-scrollbar mt-4 flex gap-3 overflow-x-hidden px-4 pb-2">
            <TrendingSkeleton />
            <TrendingSkeleton />
            <TrendingSkeleton />
          </div>
        </section>
      )}

      {/* PARCOURIR — by type and by price. On a phone, two rows of chips in
          the thumb's rhythm, each under its own title; from lg up, one block
          under « Parcourir »: eight illustrated tiles and four price pills. */}
      <section className="mt-10 px-4 lg:mt-[4.5rem] lg:px-0" aria-labelledby="home-browse">
        <div className="hidden items-end justify-between gap-3 lg:flex">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-subtle">{t("home.browseEyebrow")}</p>
            <h2 id="home-browse" className={`mazed-h2 mt-1.5 text-[24px] text-foreground ${arabic}`}>
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

        <h2 className={`mazed-h2 text-[21px] text-foreground lg:hidden ${arabic}`}>{t("home.browseByType")}</h2>
        <div className="snap-rail hide-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:mt-6 lg:grid lg:grid-cols-4 lg:gap-3 lg:overflow-visible lg:p-0 xl:grid-cols-8">
          {PROPERTY_TYPES.map((pt) => (
            <Link
              key={pt.key}
              href={catalogueHrefForType(pt.key) as `/annonces`}
              className="tap-target group inline-flex shrink-0 snap-start items-center gap-2 rounded-full bg-surface px-4 py-2.5 ring-1 ring-border transition hover:ring-foreground/40 active:scale-[0.97] lg:flex lg:flex-col lg:rounded-2xl lg:px-3 lg:py-5 lg:hover:-translate-y-0.5 lg:hover:shadow-[var(--shadow-card)] lg:hover:ring-foreground/30 lg:active:scale-100"
            >
              <pt.Icon className="size-4 text-muted lg:hidden" strokeWidth={2} aria-hidden />
              {/* The tile's illustration: lazy, so a phone (where it is
                  display:none) never downloads it. */}
              <picture className="hidden lg:block">
                <source srcSet={`/icons/${pt.img}.avif`} type="image/avif" />
                <source srcSet={`/icons/${pt.img}.webp`} type="image/webp" />
                <img
                  src={`/icons/${pt.img}.webp`}
                  alt=""
                  width={64}
                  height={64}
                  loading="lazy"
                  decoding="async"
                  className="size-14 transition-transform duration-300 group-hover:scale-105"
                />
              </picture>
              <span className={`whitespace-nowrap text-[13px] font-bold leading-none text-foreground lg:whitespace-normal lg:leading-normal ${arabic}`}>
                {t(`property.types.${pt.key}`)}
              </span>
            </Link>
          ))}
        </div>

        <h2 className={`mazed-h2 mt-7 text-[21px] text-foreground lg:hidden ${arabic}`}>{t("home.browseByPrice")}</h2>
        <div className="snap-rail hide-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:grid lg:grid-cols-4 lg:gap-3 lg:overflow-visible lg:p-0">
          {PRICE_BUCKETS.map((b) => (
            <Link
              key={b.key}
              href={`/annonces?${b.query}` as `/annonces`}
              className="tap-target group inline-flex shrink-0 snap-start items-center justify-center whitespace-nowrap rounded-full bg-surface px-4 py-2.5 text-[13px] font-bold leading-none text-foreground ring-1 ring-border transition hover:ring-foreground/40 active:scale-[0.97] lg:flex lg:justify-between lg:rounded-2xl lg:px-5 lg:py-3.5 lg:text-[13.5px] lg:leading-normal lg:hover:ring-foreground/30 lg:active:scale-100"
            >
              {t(`home.priceBuckets.${b.labelKey}`)}
              <ArrowUpRight className="hidden size-4 text-subtle transition group-hover:text-foreground lg:block rtl:-scale-x-100" strokeWidth={2.2} aria-hidden />
            </Link>
          ))}
        </div>
      </section>

      {/* « À découvrir » — what no rail above shows: a 2-up grid on a phone,
          a rail like the others from lg up. */}
      {explore && <HomeRailSection rail={explore} savedIds={savedIds} loggedIn={loggedIn} grid />}

      {/* « Guides utiles » — the newest guides, while there is one to read
          (the console's `guides_strip_count`, 0 = none). On a phone this is
          the way to them: the bottom bar has no room for a sixth tab. */}
      <GuidesStrip via="home" className="px-4 lg:px-0" />

      {/* Why Mazed Immo, how it works, and the call to publish. */}
      <WhyBand />
      <SellBand />
    </div>
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Browse-by-type / browse-by-price tables.
// ──────────────────────────────────────────────────────────────────────

// Labels come from `property.types.<key>`. `Icon` is the phone's chip;
// `img` names the desktop tile's illustration in /public/icons
// (`<img>.{avif,webp}`): the set has six, and the two categories added here
// borrow the closest one rather than ship a broken tile.
const PROPERTY_TYPES: {
  key: string;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  img: string;
}[] = [
  { key: "apartment",  Icon: Building2, img: "apartment" },
  { key: "villa",      Icon: Home,      img: "villa" },
  { key: "house",      Icon: Home,      img: "house" },
  { key: "land",       Icon: Trees,     img: "land" },
  // Fermes and Dépôts are categories in the catalogue with chips of their own;
  // the home tiles listed six of the eight, so two were unreachable from here.
  { key: "farm",       Icon: Wheat,     img: "land" },
  { key: "commercial", Icon: Store,     img: "commercial" },
  { key: "office",     Icon: Briefcase, img: "office" },
  { key: "warehouse",  Icon: Warehouse, img: "commercial" },
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
