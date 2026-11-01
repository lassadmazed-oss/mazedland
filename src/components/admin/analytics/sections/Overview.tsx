import type { SupabaseClient } from "@supabase/supabase-js";
import { getTranslations } from "next-intl/server";
import { AlertTriangle, ArrowRight, Lightbulb, TrendingUp } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { Settings } from "@/lib/settings/registry";
import { reactiveRules } from "@/lib/pro/reactivity";
import { buildInsights, insightRules, type Insight } from "@/lib/analytics/insights";
import { daysOf, pctChange, type Period } from "@/lib/analytics/period";
import { funnelSteps, pick, rate } from "@/lib/analytics/shape";
import * as q from "@/lib/analytics/queries";
import { formatters } from "../format";
import { Funnel, LineChart } from "../Charts";
import { Card, ErrorNote, errorText, Grid, KpiTile, Section } from "../ui";

/**
 * The first tab: what to retain, the figures of the period against the
 * previous one, the trend, the publish funnel and the conversions.
 */
export async function Overview({ admin, period, settings, locale }: { admin: SupabaseClient; period: Period; settings: Settings; locale: string }) {
  const t = await getTranslations("adminAnalytics");
  const f = formatters(locale, t("common.tnd"));
  let data: [q.Kpis, q.Kpis, q.DayPoint[], q.WeekPoint[], q.Marketplace, q.Demand, q.Pro];
  try {
    data = await Promise.all([
      q.kpis(admin, period.from, period.to),
      q.kpis(admin, period.prevFrom, period.prevTo),
      q.series(admin, period),
      // The latest week, the one before, and the baseline weeks behind them.
      q.weekly(admin, period.to, settings.analytics_baseline_weeks + 2),
      q.marketplace(admin, period, settings.analytics_expiring_days),
      q.demand(admin, period, settings.analytics_top_limit, settings.reactive_hours),
      q.pro(admin, period),
    ]);
  } catch (e) {
    return <ErrorNote text={t("error", { message: errorText(e) })} />;
  }
  const [cur, prev, series, weeks, market, demand, pro] = data;

  // ── Insights ──
  const thisWeek = weeks[weeks.length - 1] ?? {};
  const lastWeek = weeks[weeks.length - 2] ?? {};
  const baseline = weeks.slice(0, Math.max(0, weeks.length - 2));
  const insights = buildInsights({
    thisWeek, lastWeek, baseline,
    zeroSearches: demand.zero_searches,
    topListings: demand.top_listings,
    agences: demand.visits_by_agence,
    governorates: market.by_governorate,
    expiring: market.quality.expiring,
    pendingPayments: pro.pending_now,
    noPhoto: market.quality.no_photo,
    rules: insightRules(settings, reactiveRules(settings)),
  });
  const sentence = (i: Insight): string => {
    const v: Record<string, string | number> = {};
    for (const [k, val] of Object.entries(i.values)) v[k] = typeof val === "number" ? f.n(val) : val;
    if (i.kind.startsWith("mover") || i.kind.startsWith("anomaly")) v.metric = t(`kpi.${i.subject}`);
    if (i.kind === "pending_payments") v.amount = f.n(Number(i.values.amount));
    return t(`insights.${i.kind}`, v);
  };

  // ── KPIs ──
  const days = daysOf(period).map(f.day);
  const spark = (key: keyof q.DayPoint) => pick(series, key);
  const tile = (key: keyof q.Kpis, opts: { money?: boolean; spark?: keyof q.DayPoint; hint?: string } = {}) => (
    <KpiTile
      key={key}
      label={t(`kpi.${key}`)}
      value={opts.money ? f.money(cur[key]) : f.n(cur[key])}
      delta={pctChange(cur[key], prev[key])}
      deltaLabel={t("common.previous")} formatDelta={f.delta}
      spark={opts.spark ? spark(opts.spark) : undefined}
      hint={opts.hint}
    />
  );
  const convContact = rate(cur.reveals + cur.visit_requests, cur.listing_views);
  const convContactPrev = rate(prev.reveals + prev.visit_requests, prev.listing_views);
  const convSearch = rate(cur.listing_views, cur.searches);
  const convSearchPrev = rate(prev.listing_views, prev.searches);
  const convPublish = rate(market.funnel.published, market.funnel.start);

  const steps = funnelSteps([
    { key: "start", value: market.funnel.start },
    { key: "category", value: market.funnel.category },
    { key: "photos", value: market.funnel.photos },
    { key: "details", value: market.funnel.details },
    { key: "review", value: market.funnel.review },
    { key: "submitted", value: market.funnel.submitted },
    { key: "published", value: market.funnel.published },
  ]);

  return (
    <>
      <section className="mt-6 rounded-2xl bg-[var(--paper-warm)] p-5 ring-1 ring-border">
        <div className="flex items-start gap-3">
          <Lightbulb className="mt-0.5 size-5 shrink-0 text-foreground" strokeWidth={2.2} aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className="mazed-h2 text-[17px] text-foreground">{t("insights.title")}</h2>
            <p className="mt-0.5 text-[12px] text-muted">{t("insights.sub")}</p>
          </div>
        </div>
        {insights.length === 0 ? (
          <p className="mt-3 text-[13px] text-muted">{t("insights.empty")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-border/70">
            {insights.map((i) => (
              <li key={`${i.kind}:${i.subject}`}>
                <Link href={i.href as never} className="group flex items-start gap-3 py-2.5 text-[13px] leading-relaxed text-foreground">
                  {i.tone === "good" ? (
                    <TrendingUp className="mt-0.5 size-4 shrink-0 text-[var(--tone-ok)]" strokeWidth={2.2} aria-hidden />
                  ) : (
                    <AlertTriangle className={`mt-0.5 size-4 shrink-0 ${i.tone === "bad" ? "text-[var(--tone-bad)]" : "text-[var(--tone-warn)]"}`} strokeWidth={2.2} aria-hidden />
                  )}
                  <span className="min-w-0 flex-1">{sentence(i)}</span>
                  <ArrowRight className="mt-1 size-3.5 shrink-0 text-subtle transition group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" strokeWidth={2} aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Section title={t("overview.kpisTitle")} hint={t("common.sinceEvents")}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {tile("visitors", { spark: "visitors", hint: t("kpiHint.visitors") })}
          {tile("page_views", { spark: "page_views" })}
          {tile("searches", { spark: "searches" })}
          {tile("listing_views", { spark: "listing_views" })}
          {tile("listings_online")}
          {tile("listings_new", { spark: "listings_new" })}
          {tile("publishes", { spark: "publishes" })}
          {tile("reveals", { spark: "reveals" })}
          {tile("visit_requests", { spark: "visit_requests" })}
          {tile("favourites", { spark: "favourites" })}
          {tile("demandes")}
          {tile("signups", { spark: "signups" })}
          {tile("agences_open")}
          {tile("agences_new")}
          {tile("revenue", { money: true, spark: "revenue", hint: t("kpiHint.revenue") })}
          {tile("paid_count")}
        </div>
      </Section>

      <Section title={t("overview.convTitle")}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiTile label={t("kpi.conv_contact")} value={f.pct(convContact)} delta={convContact !== null && convContactPrev !== null ? pctChange(convContact, convContactPrev) : null} deltaLabel={t("common.previous")} formatDelta={f.delta} hint={t("kpiHint.conv_contact")} />
          <KpiTile label={t("kpi.conv_search")} value={f.pct(convSearch)} delta={convSearch !== null && convSearchPrev !== null ? pctChange(convSearch, convSearchPrev) : null} deltaLabel={t("common.previous")} formatDelta={f.delta} hint={t("kpiHint.conv_search")} />
          <KpiTile label={t("kpi.conv_publish")} value={f.pct(convPublish)} hint={t("kpiHint.conv_publish")} />
        </div>
      </Section>

      <Section title={t("overview.trendsTitle")} hint={t("charts.daily")}>
        <Grid>
          <Card>
            <p className="text-[12px] font-semibold text-muted">{t("kpi.visitors")} · {t("kpi.page_views")}</p>
            <div className="mt-2">
              <LineChart label={`${t("kpi.visitors")} · ${t("kpi.page_views")}`} labels={days} series={[{ name: t("kpi.page_views"), values: spark("page_views") }, { name: t("kpi.visitors"), values: spark("visitors"), muted: true }]} format={f.n} />
            </div>
          </Card>
          <Card>
            <p className="text-[12px] font-semibold text-muted">{t("kpi.listing_views")} · {t("kpi.reveals")}</p>
            <div className="mt-2">
              <LineChart label={`${t("kpi.listing_views")} · ${t("kpi.reveals")}`} labels={days} series={[{ name: t("kpi.listing_views"), values: spark("listing_views") }, { name: t("kpi.reveals"), values: spark("reveals"), muted: true }]} format={f.n} />
            </div>
          </Card>
        </Grid>
      </Section>

      <Section title={t("overview.funnelTitle")} hint={t("marketplace.funnelNote", { abandoned: f.n(market.funnel.abandoned), drafts: f.n(market.funnel.drafts) })}>
        <Card>
          <Funnel label={t("overview.funnelTitle")} steps={steps.map((s) => ({ label: t(`marketplace.funnelSteps.${s.key}`), value: f.n(s.value), share: s.share, drop: s.drop === null ? null : t("marketplace.drop", { pct: s.drop }) }))} />
        </Card>
      </Section>
    </>
  );
}
