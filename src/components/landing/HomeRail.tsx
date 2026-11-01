import { getTranslations, getLocale } from "next-intl/server";
import { ChevronRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { AutoRail } from "@/components/landing/AutoRail";
import { AnnonceCard } from "@/components/listing/AnnonceCard";
import { Impressions } from "@/components/analytics/Impressions";
import { isRtl } from "@/lib/i18n";
import type { HomeRail } from "@/lib/home/rails";

/**
 * One rail of the home page — heading, « Tout voir », and the cards moving by
 * themselves — in either layout. The phone page and HomeDesktop each had their
 * own copy of this markup for three rails; with ten, one copy is what keeps
 * them looking like the same site.
 *
 * `layout` carries the only differences there were: the card width, the title
 * size, the spacing, and the arrows, which only a mouse needs.
 */

type Layout = "phone" | "desktop";

const SIZES: Record<Layout, { section: string; card: string; title: string; sub: string; pad: string }> = {
  phone: {
    section: "mt-10",
    // Wide enough for the 4:3 photo to be a photo (260 × 195) and for the
    // next card to peek in from the edge, which is what says « swipe ».
    card: "w-[264px]",
    title: "text-[21px]",
    sub: "text-[12.5px]",
    pad: "px-4",
  },
  desktop: {
    section: "mt-16",
    card: "w-[300px]",
    title: "text-[24px]",
    sub: "text-[13.5px]",
    pad: "px-0",
  },
};

export async function HomeRailSection({
  rail,
  layout,
  savedIds,
  loggedIn,
}: {
  rail: HomeRail;
  layout: Layout;
  savedIds: Set<string>;
  loggedIn: boolean;
}) {
  const t = await getTranslations();
  const isRTL = isRtl(await getLocale());
  const size = SIZES[layout];
  // Both layouts are in the page at once (CSS shows one), so the id says which.
  const headingId = `home-rail-${layout}-${rail.key}`;

  return (
    <section className={size.section} aria-labelledby={headingId}>
      <RailHeading
        id={headingId}
        layout={layout}
        isRTL={isRTL}
        eyebrow={t(`home.rails.${rail.key}.eyebrow`)}
        title={t(`home.rails.${rail.key}.title`)}
        sub={t(`home.rails.${rail.key}.sub`)}
        count={rail.rows.length}
        href={rail.href}
        seeAllLabel={t("home.seeAll")}
      />
      {/* Before the rail, never inside it: the rail measures its children. */}
      <Impressions ids={rail.rows.map((a) => a.id)} surface={`home_${rail.key}`} />
      <AutoRail arrows={layout === "desktop"}>
        {rail.rows.map((a) => (
          <div key={a.id} className={`${size.card} shrink-0 snap-start`}>
            <AnnonceCard
              listing={a}
              saved={savedIds.has(a.id)}
              loggedIn={loggedIn}
              sizes={layout === "desktop" ? "300px" : "264px"}
            />
          </div>
        ))}
        {/* Room after the last card, so it does not sit on the screen's edge. */}
        <div className="w-1 shrink-0" />
      </AutoRail>
    </section>
  );
}

/**
 * A rail's heading: a small eyebrow, the title with its count, a line under
 * it, and « Tout voir » at the end. Also heads the phone's « À découvrir » grid.
 */
export function RailHeading({
  id,
  layout,
  isRTL,
  eyebrow,
  title,
  sub,
  count,
  href,
  seeAllLabel,
}: {
  id?: string;
  layout: Layout;
  isRTL: boolean;
  eyebrow?: string;
  title: string;
  sub?: string;
  count?: number;
  /** The catalogue search the section is the first cards of. */
  href: string;
  seeAllLabel: string;
}) {
  const size = SIZES[layout];
  const arabic = isRTL ? "font-arabic" : "";
  return (
    <div className={`flex items-end justify-between gap-3 ${size.pad}`}>
      <div className="min-w-0">
        {eyebrow && (
          <p className={`mb-1 text-[11px] font-extrabold uppercase tracking-[0.14em] text-subtle ${isRTL ? "font-arabic" : ""}`}>
            {eyebrow}
          </p>
        )}
        <h2 id={id} className={`mazed-h2 inline-flex items-baseline gap-2 text-foreground ${size.title} ${arabic}`}>
          {title}
          {count !== undefined && (
            <span className="mazed-tabular text-[13px] font-bold text-subtle">{count}</span>
          )}
        </h2>
        {sub && <p className={`mt-1 ${size.sub} leading-snug text-muted ${arabic}`}>{sub}</p>}
      </div>
      <Link
        href={href as "/annonces"}
        className="tap-target inline-flex shrink-0 items-center gap-0.5 self-end whitespace-nowrap rounded-full px-2 text-[13px] font-bold text-foreground underline-offset-4 transition hover:underline"
      >
        {seeAllLabel}
        <ChevronRight className="size-4 rtl:-scale-x-100" strokeWidth={2.4} aria-hidden />
      </Link>
    </div>
  );
}
