import { getTranslations } from "next-intl/server";
import { ArrowUpRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { governorateLabel } from "@/lib/tunisia";
import type { GovernorateStats } from "@/lib/market/stats";
import { PriceTable } from "./PriceTable";
import { FigureTile, type MarketFormat } from "./ui";

/**
 * One governorate's figures, under its own anchor (`#sfax`), so the
 * catalogue filtered on it can point straight here: what is online, the
 * median asking prices, the types with annonces, the demand of the last
 * window, and the way to the annonces themselves.
 */
export async function GovernorateBlock({ g, f, locale, days, min }: { g: GovernorateStats; f: MarketFormat; locale: string; days: number; min: number }) {
  const t = await getTranslations("market");
  const name = governorateLabel(g.gov, locale);
  const demandParts = g.demand
    ? [
        g.demand.searches !== null ? t("demand.searchesIn", { count: g.demand.searches }) : null,
        g.demand.visits !== null ? t("demand.visitsIn", { count: g.demand.visits }) : null,
        g.demand.demandes !== null ? t("demand.demandesIn", { count: g.demand.demandes }) : null,
      ].filter((p): p is string => Boolean(p))
    : [];
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

  return (
    <article id={g.slug} className="scroll-mt-24 rounded-[var(--radius-2xl)] bg-surface p-4 ring-1 ring-border lg:p-6" aria-labelledby={`gov-${g.slug}`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`gov-${g.slug}`} className="mazed-h2 text-[20px] text-foreground lg:text-[24px]">{name}</h3>
          <p className="mt-1 text-[13px] text-muted">
            <span className="font-bold text-foreground">{f.n(g.online)}</span> {t("governorates.online")} · {f.n(g.saleCount)} {t("governorates.sale")} · {f.n(g.rentCount)} {t("governorates.rent")}
          </p>
        </div>
        <Link
          href={`/annonces?gov=${encodeURIComponent(g.gov)}` as never}
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface px-3.5 py-2 text-[12.5px] font-bold text-foreground ring-1 ring-border transition hover:ring-foreground/40"
        >
          {t("governorates.catalogue", { gov: name })}
          <ArrowUpRight className="size-3.5 rtl:-scale-x-100" strokeWidth={2.4} aria-hidden />
        </Link>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <FigureTile
          label={t("governorates.medianSale")}
          figure={g.sale.median}
          format={f.money}
          basis={t("basedOn", { count: g.sale.median.n })}
          trend={g.sale.trend}
          trendLabel={trendLabel(g.sale.trend.delta)}
          notEnough={t("notEnough")}
          notEnoughHint={t("notEnoughHint", { min })}
        />
        <FigureTile
          label={t("governorates.medianRent")}
          figure={g.rent.median}
          format={f.rent}
          basis={t("basedOn", { count: g.rent.median.n })}
          trend={g.rent.trend}
          trendLabel={trendLabel(g.rent.trend.delta)}
          notEnough={t("notEnough")}
          notEnoughHint={t("notEnoughHint", { min })}
        />
      </div>

      {g.categories.length > 0 && (
        <>
          <p className="mt-5 text-[11px] font-extrabold uppercase tracking-[0.14em] text-subtle">{t("governorates.categories")}</p>
          <div className="mt-2">
            <PriceTable rows={g.categories} f={f} words={words} gov={g.gov} compact />
          </div>
        </>
      )}

      <p className="mt-4 text-[12.5px] text-muted">
        <span className="font-semibold text-foreground">{t("governorates.demand", { days })}</span> ·{" "}
        {demandParts.length > 0 ? demandParts.join(" · ") : t("governorates.noDemand")}
      </p>
    </article>
  );
}
