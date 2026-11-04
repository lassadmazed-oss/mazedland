import { getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight, MapPinned } from "lucide-react";
import { GOVERNORATE_ANCHOR, GOVERNORATE_PATHS, TUNISIA_VIEWBOX } from "@/lib/geo/tunisiaShape";
import { layoutBubbles } from "@/lib/geo/homeMap";
import { TUNISIAN_GOVERNORATES, governorateLabel } from "@/lib/tunisia";
import { formatNumber } from "@/lib/utils";
import { isRtl } from "@/lib/i18n";

/**
 * « Les annonces par gouvernorat » on the home page (the owner, 2026-11-04):
 * Tunisia drawn by governorate, each with the number of its annonces online,
 * a touch away from the map search on that governorate (?gov=…&vue=carte).
 *
 * Drawn on the server as plain SVG (src/lib/geo/tunisiaShape.ts): no map
 * library and no tiles, so the static home page stays as fast as it was —
 * the real map loads only for whoever opens it. A governorate without an
 * annonce is drawn pale and leads nowhere; the console chooses from how many
 * annonces the section shows at all (home_map_min_total) and from how many a
 * governorate gets its circle (home_map_min_count).
 *
 * Plain <a> links: the home page is static, and so is what they open.
 */
export async function HomeMap({ counts, locale, minCount }: { counts: Record<string, number>; locale: string; minCount: number }) {
  const t = await getTranslations("homeMap");
  const rtl = isRtl(locale);
  const ChevronEnd = rtl ? ChevronLeft : ChevronRight;
  const shown = (TUNISIAN_GOVERNORATES as readonly string[]).filter((g) => (counts[g] ?? 0) >= minCount);
  const max = Math.max(1, ...shown.map((g) => counts[g] ?? 0));
  const bubbles = layoutBubbles(shown.map((g) => ({ gov: g, count: counts[g] ?? 0, anchor: GOVERNORATE_ANCHOR[g] })), TUNISIA_VIEWBOX);
  const href = (g: string) => `/${locale}/annonces?gov=${encodeURIComponent(g)}&vue=carte`;
  const label = (g: string) => t("aria", { gov: governorateLabel(g, locale), count: counts[g] ?? 0 });
  const ranked = [...shown].sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0) || a.localeCompare(b));
  const arabic = rtl ? "font-arabic" : "";

  return (
    <section className="mt-10 px-4 lg:mt-[4.5rem] lg:px-0" aria-labelledby="home-map">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-subtle">{t("eyebrow")}</p>
          <h2 id="home-map" className={`mazed-h2 mt-1.5 text-[21px] text-foreground lg:text-[24px] ${arabic}`}>{t("title")}</h2>
          <p className="mt-1 max-w-md text-[13px] leading-relaxed text-muted">{t("hint")}</p>
        </div>
        <a
          href={`/${locale}/annonces?vue=carte`}
          className="inline-flex shrink-0 items-center gap-0.5 rounded-full px-2 text-[13px] font-bold text-foreground underline-offset-4 transition hover:underline"
        >
          {t("seeMap")}
          <ChevronEnd className="size-4" strokeWidth={2.4} aria-hidden />
        </a>
      </div>

      <div className="mt-4 rounded-[var(--radius-3xl)] bg-surface-2/60 p-4 ring-1 ring-border sm:p-6 lg:flex lg:items-center lg:gap-12 lg:p-8">
        <svg
          viewBox={`0 0 ${TUNISIA_VIEWBOX[0]} ${TUNISIA_VIEWBOX[1]}`}
          className="mx-auto block h-[380px] w-auto shrink-0 sm:h-[460px] lg:mx-0 lg:h-[540px]"
          role="group"
          aria-label={t("mapLabel")}
        >
          {(TUNISIAN_GOVERNORATES as readonly string[]).map((g) => {
            const n = counts[g] ?? 0;
            const path = (
              <path
                d={GOVERNORATE_PATHS[g]}
                fill={n > 0 ? "var(--foreground)" : "var(--surface)"}
                fillOpacity={n > 0 ? 0.06 + 0.22 * Math.sqrt(n / max) : 1}
                stroke="var(--border-strong)"
                strokeWidth={0.8}
                strokeLinejoin="round"
                className={n >= minCount && n > 0 ? "transition-[fill-opacity] duration-150 hover:[fill-opacity:0.42]" : undefined}
              >
                <title>{label(g)}</title>
              </path>
            );
            return n >= minCount && n > 0 ? (
              <a key={g} href={href(g)} aria-label={label(g)}>
                {path}
              </a>
            ) : (
              <g key={g}>{path}</g>
            );
          })}
          {/* A circle moved off its town (Grand Tunis) keeps a line to it. */}
          {bubbles.map((b) =>
            Math.hypot(b.x - b.ax, b.y - b.ay) > b.r * 0.6 ? (
              <g key={`lead-${b.gov}`} aria-hidden>
                <line x1={b.ax} y1={b.ay} x2={b.x} y2={b.y} stroke="var(--foreground)" strokeWidth={1} strokeOpacity={0.5} />
                <circle cx={b.ax} cy={b.ay} r={2.2} fill="var(--foreground)" />
              </g>
            ) : null,
          )}
          {bubbles.map((b) => (
            <a key={b.gov} href={href(b.gov)} aria-label={label(b.gov)} className="group">
              <circle cx={b.x} cy={b.y} r={b.r} fill="var(--foreground)" stroke="var(--background)" strokeWidth={2.5} className="transition-transform" />
              <text
                x={b.x}
                y={b.y}
                dy="0.35em"
                textAnchor="middle"
                fill="var(--background)"
                fontSize={b.r * (b.count >= 100 ? 0.72 : 0.9)}
                fontWeight={800}
                className="mazed-tabular pointer-events-none"
              >
                {formatNumber(b.count, locale)}
              </text>
              <title>{label(b.gov)}</title>
            </a>
          ))}
        </svg>

        {/* The same, in words: the governorates with the most annonces, each to its map. */}
        <ol className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:mt-0 lg:flex-1 lg:grid-cols-2 xl:grid-cols-3">
          {ranked.map((g) => (
            <li key={g}>
              <a
                href={href(g)}
                aria-label={label(g)}
                className="tap-target flex items-center justify-between gap-2 rounded-2xl bg-surface px-3.5 py-2.5 ring-1 ring-border transition hover:ring-foreground/40"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <MapPinned className="size-4 shrink-0 text-muted" strokeWidth={2} aria-hidden />
                  <span className={`truncate text-[13.5px] font-bold text-foreground ${arabic}`}>{governorateLabel(g, locale)}</span>
                </span>
                {/* The number alone: « 1 annonce » took the name's room on a phone. */}
                <span className="mazed-tabular shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[12px] font-extrabold text-foreground">{formatNumber(counts[g] ?? 0, locale)}</span>
              </a>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
