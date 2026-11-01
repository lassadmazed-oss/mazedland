import type { SupabaseClient } from "@supabase/supabase-js";
import { getTranslations } from "next-intl/server";
import type { Settings } from "@/lib/settings/registry";
import { pctChange, type Period } from "@/lib/analytics/period";
import { formatDate } from "@/lib/utils";
import * as q from "@/lib/analytics/queries";
import { formatters } from "../format";
import { Ga4Connect } from "../Ga4Connect";
import { LineChart } from "../Charts";
import { Card, Grid, KpiTile, Section, Table, type TableRow } from "../ui";

/**
 * Google's reports, when the console is connected to the property; the way
 * to connect it otherwise. Either way the rest of the page is complete.
 */
export async function Traffic({ admin, period, settings, locale }: { admin: SupabaseClient; period: Period; settings: Settings; locale: string }) {
  const t = await getTranslations("adminAnalytics");
  const f = formatters(locale, t("common.tnd"));
  const status = q.ga4Status(settings.analytics_ga_property_id);

  const head = (
    <Section title={t("traffic.title")} hint={t("traffic.description")}>
      <Ga4Connect state={status.state} />
    </Section>
  );
  if (status.state !== "ready") return head;

  const result = await q.ga4Reports(admin, status, period, settings.analytics_ga_cache_minutes, settings.analytics_top_limit);
  if (!result.data) {
    return (
      <>
        {head}
        <p className="mt-4 rounded-2xl bg-[var(--tone-bad-bg)] px-4 py-3 text-[12.5px] font-semibold text-[var(--tone-bad)] ring-1 ring-[var(--tone-bad-ring)]">{t("traffic.failed", { error: result.error })}</p>
      </>
    );
  }
  const g = result.data;
  const tile = (label: string, cur: number, prev: number, format = f.n) => (
    <KpiTile label={label} value={format(cur)} delta={pctChange(cur, prev)} deltaLabel={t("common.previous")} formatDelta={f.delta} />
  );
  const row = (key: string, cells: Record<string, React.ReactNode>, csv: (string | number)[]): TableRow => ({ _key: key, _csv: csv, ...cells });
  // The reports Google refused, named as the page names them.
  const reportName = (k: string) =>
    k === "totals" ? t("traffic.users") : k === "previous" ? t("common.previous") : k === "daily" ? t("charts.daily") : t.has(`traffic.${k}`) ? t(`traffic.${k}`) : k;
  const refused = Object.keys(g.errors).filter((k) => k !== "searchTerms").map(reportName);

  return (
    <>
      {head}
      <p className="mt-3 text-[11.5px] text-subtle">
        {t("traffic.fetchedAt", { time: formatDate(result.fetchedAt, locale, "medium") })} {result.cached ? t("traffic.cached") : ""}
        {refused.length > 0 && <> · {t("traffic.partial", { list: refused.join(", ") })}</>}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tile(t("traffic.users"), g.totals.users, g.previous.users)}
        {tile(t("traffic.newUsers"), g.totals.newUsers, g.previous.newUsers)}
        {tile(t("traffic.sessions"), g.totals.sessions, g.previous.sessions)}
        {tile(t("traffic.pageViews"), g.totals.pageViews, g.previous.pageViews)}
        {tile(t("traffic.engaged"), g.totals.engagedSessions, g.previous.engagedSessions)}
        {tile(t("traffic.avgSession"), g.totals.avgSessionSeconds, g.previous.avgSessionSeconds, (v) => t("traffic.seconds", { count: f.n(v) }))}
      </div>
      {g.daily.length > 1 && (
        <Card className="mt-4">
          <p className="text-[12px] font-semibold text-muted">{t("charts.daily")}</p>
          <div className="mt-2">
            <LineChart label={`${t("traffic.pageViews")} · ${t("traffic.users")}`} labels={g.daily.map((d) => f.day(d.day))} series={[{ name: t("traffic.pageViews"), values: g.daily.map((d) => d.pageViews) }, { name: t("traffic.users"), values: g.daily.map((d) => d.users), muted: true }]} format={f.n} />
          </div>
        </Card>
      )}
      <Grid>
        <Section title={t("traffic.topPages")}>
          <Table name={t("traffic.topPages")} exportLabel={t("common.export")} empty={t("common.empty")}
            columns={[{ key: "page", label: t("traffic.cols.page") }, { key: "views", label: t("traffic.cols.views"), num: true }, { key: "users", label: t("traffic.cols.users"), num: true }]}
            rows={g.topPages.map((p, i) => row(`${i}`, { page: <span dir="ltr" className="break-all">{p.path}</span>, views: f.n(p.views), users: f.n(p.users) }, [p.path, p.views, p.users]))} />
        </Section>
        <Section title={t("traffic.sources")}>
          <Table name={t("traffic.sources")} exportLabel={t("common.export")} empty={t("common.empty")}
            columns={[{ key: "source", label: t("traffic.source") }, { key: "medium", label: t("traffic.medium") }, { key: "sessions", label: t("traffic.cols.sessions"), num: true }, { key: "users", label: t("traffic.cols.users"), num: true }]}
            rows={g.sources.map((s, i) => row(`${i}`, { source: <span dir="ltr">{s.source}</span>, medium: <span dir="ltr">{s.medium}</span>, sessions: f.n(s.sessions), users: f.n(s.users) }, [s.source, s.medium, s.sessions, s.users]))} />
        </Section>
        <Section title={t("traffic.devices")}>
          <Table name={t("traffic.devices")} exportLabel={t("common.export")} empty={t("common.empty")}
            columns={[{ key: "device", label: t("traffic.cols.device") }, { key: "users", label: t("traffic.cols.users"), num: true }, { key: "sessions", label: t("traffic.cols.sessions"), num: true }]}
            rows={g.devices.map((d, i) => row(`${i}`, { device: d.device, users: f.n(d.users), sessions: f.n(d.sessions) }, [d.device, d.users, d.sessions]))} />
        </Section>
        <Section title={t("traffic.languages")}>
          <Table name={t("traffic.languages")} exportLabel={t("common.export")} empty={t("common.empty")}
            columns={[{ key: "language", label: t("traffic.cols.language") }, { key: "users", label: t("traffic.cols.users"), num: true }]}
            rows={g.languages.map((d, i) => row(`${i}`, { language: d.language, users: f.n(d.users) }, [d.language, d.users]))} />
        </Section>
        <Section title={t("traffic.countries")}>
          <Table name={t("traffic.countries")} exportLabel={t("common.export")} empty={t("common.empty")}
            columns={[{ key: "country", label: t("traffic.cols.country") }, { key: "users", label: t("traffic.cols.users"), num: true }]}
            rows={g.countries.map((d, i) => row(`${i}`, { country: d.country, users: f.n(d.users) }, [d.country, d.users]))} />
        </Section>
        <Section title={t("traffic.cities")}>
          <Table name={t("traffic.cities")} exportLabel={t("common.export")} empty={t("common.empty")}
            columns={[{ key: "city", label: t("traffic.cols.city") }, { key: "users", label: t("traffic.cols.users"), num: true }]}
            rows={g.cities.map((d, i) => row(`${i}`, { city: d.city, users: f.n(d.users) }, [d.city, d.users]))} />
        </Section>
        <Section title={t("traffic.landingPages")}>
          <Table name={t("traffic.landingPages")} exportLabel={t("common.export")} empty={t("common.empty")}
            columns={[{ key: "page", label: t("traffic.cols.page") }, { key: "sessions", label: t("traffic.cols.sessions"), num: true }]}
            rows={g.landingPages.map((p, i) => row(`${i}`, { page: <span dir="ltr" className="break-all">{p.path}</span>, sessions: f.n(p.sessions) }, [p.path, p.sessions]))} />
        </Section>
        <Section title={t("traffic.searchTerms")} hint={g.errors.searchTerms ? t("traffic.searchTermsHint") : undefined}>
          <Table name={t("traffic.searchTerms")} exportLabel={t("common.export")} empty={t("common.empty")}
            columns={[{ key: "term", label: t("traffic.cols.term") }, { key: "count", label: t("traffic.cols.count"), num: true }]}
            rows={g.searchTerms.map((s, i) => row(`${i}`, { term: s.term, count: f.n(s.count) }, [s.term, s.count]))} />
        </Section>
      </Grid>
    </>
  );
}
