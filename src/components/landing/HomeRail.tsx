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
 * themselves — at every width. The page is one tree since 2026-11-03: the
 * phone and the desktop used to each get a copy of every rail, and a phone
 * downloaded, parsed and hydrated both.
 *
 * What changes at `lg` is CSS only: the card width, the title size, the
 * spacing, and the arrows, which only a mouse needs (AutoRail shows them
 * from lg up). `grid` turns the rail into a two-column grid below lg — the
 * phone's « À découvrir » — and leaves it a rail above.
 */

export async function HomeRailSection({
  rail,
  savedIds,
  loggedIn,
  grid = false,
}: {
  rail: HomeRail;
  savedIds: Set<string>;
  loggedIn: boolean;
  /** Below lg, the cards on a 2-up grid instead of a rail. */
  grid?: boolean;
}) {
  const t = await getTranslations();
  const isRTL = isRtl(await getLocale());
  const headingId = `home-rail-${rail.key}`;

  return (
    <section className="mt-10 lg:mt-16" aria-labelledby={headingId}>
      <RailHeading
        id={headingId}
        isRTL={isRTL}
        eyebrow={t(`home.rails.${rail.key}.eyebrow`)}
        title={t(`home.rails.${rail.key}.title`)}
        sub={t(`home.rails.${rail.key}.sub`)}
        count={rail.rows.length}
        // The phone's grid heading never had one; the desktop's rail does.
        countFromLg={grid}
        href={rail.href}
        seeAllLabel={t("home.seeAll")}
      />
      {/* Before the rail, never inside it: the rail measures its children. */}
      <Impressions ids={rail.rows.map((a) => a.id)} surface={`home_${rail.key}`} />
      <AutoRail arrows grid={grid}>
        {rail.rows.map((a) => (
          // Wide enough on a phone for the 4:3 photo to be a photo (260 × 195)
          // and for the next card to peek in from the edge, which says « swipe ».
          <div key={a.id} className={grid ? "lg:w-[300px] lg:shrink-0 lg:snap-start" : "w-[264px] shrink-0 snap-start lg:w-[300px]"}>
            <AnnonceCard
              listing={a}
              saved={savedIds.has(a.id)}
              loggedIn={loggedIn}
              sizes={grid ? "(min-width: 1024px) 300px, 45vw" : "(min-width: 1024px) 300px, 264px"}
            />
          </div>
        ))}
        {/* Room after the last card, so it does not sit on the screen's edge. */}
        <div className={grid ? "hidden w-1 shrink-0 lg:block" : "w-1 shrink-0"} />
      </AutoRail>
    </section>
  );
}

/**
 * A rail's heading: a small eyebrow, the title with its count, a line under
 * it, and « Tout voir » at the end.
 */
function RailHeading({
  id,
  isRTL,
  eyebrow,
  title,
  sub,
  count,
  countFromLg = false,
  href,
  seeAllLabel,
}: {
  id?: string;
  isRTL: boolean;
  eyebrow?: string;
  title: string;
  sub?: string;
  count?: number;
  /** The count from lg up only. */
  countFromLg?: boolean;
  /** The catalogue search the section is the first cards of. */
  href: string;
  seeAllLabel: string;
}) {
  const arabic = isRTL ? "font-arabic" : "";
  return (
    <div className="flex items-end justify-between gap-3 px-4 lg:px-0">
      <div className="min-w-0">
        {eyebrow && (
          <p className={`mb-1 text-[11px] font-extrabold uppercase tracking-[0.14em] text-subtle ${isRTL ? "font-arabic" : ""}`}>
            {eyebrow}
          </p>
        )}
        <h2 id={id} className={`mazed-h2 inline-flex items-baseline gap-2 text-[21px] text-foreground lg:text-[24px] ${arabic}`}>
          {title}
          {count !== undefined && (
            <span className={`mazed-tabular text-[13px] font-bold text-subtle ${countFromLg ? "hidden lg:inline" : ""}`}>{count}</span>
          )}
        </h2>
        {sub && <p className={`mt-1 text-[12.5px] leading-snug text-muted lg:text-[13.5px] ${arabic}`}>{sub}</p>}
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
