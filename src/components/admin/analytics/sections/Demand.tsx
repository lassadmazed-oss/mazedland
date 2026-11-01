import type { SupabaseClient } from "@supabase/supabase-js";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Settings } from "@/lib/settings/registry";
import { reactiveRules } from "@/lib/pro/reactivity";
import type { Period } from "@/lib/analytics/period";
import { rate } from "@/lib/analytics/shape";
import * as q from "@/lib/analytics/queries";
import { formatters } from "../format";
import { BarList } from "../Charts";
import { Card, ErrorNote, errorText, Facts, Grid, KpiTile, Section, Table, type TableRow } from "../ui";

/** The demand: what people search, open, ask for — and how fast agences answer. */
export async function Demand({ admin, period, settings, locale }: { admin: SupabaseClient; period: Period; settings: Settings; locale: string }) {
  const t = await getTranslations("adminAnalytics");
  const f = formatters(locale, t("common.tnd"));
  const rules = reactiveRules(settings);
  let d: q.Demand;
  try {
    d = await q.demand(admin, period, settings.analytics_top_limit, rules.hours);
  } catch (e) {
    return <ErrorNote text={t("error", { message: errorText(e) })} />;
  }
  const row = (key: string, cells: Record<string, React.ReactNode>, csv: (string | number | null)[]): TableRow => ({ _key: key, _csv: csv, ...cells });
  const understoodTotal = d.understood.yes + d.understood.no;
  const filterName = (k: string) => (t.has(`demand.filterNames.${k}`) ? t(`demand.filterNames.${k}`) : k);
  const sortName = (k: string) => (t.has(`demand.sortNames.${k}`) ? t(`demand.sortNames.${k}`) : k);

  return (
    <>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiTile label={t("kpi.searches")} value={f.n(d.searches)} hint={t("demand.searchers", { count: f.n(d.searchers) })} />
        <KpiTile label={t("demand.zeroSearches")} value={f.n(d.zero_total)} />
        <KpiTile label={t("demand.understood")} value={f.pct(rate(d.understood.yes, understoodTotal))} hint={t("demand.understoodHint")} />
        <KpiTile label={t("kpi.favourites")} value={f.n(d.favourites)} />
        <KpiTile label={t("kpi.demandes")} value={f.n(d.demandes)} />
        <KpiTile label={t("demand.shares")} value={f.n(d.shares)} />
      </div>

      <Grid>
        <Section title={t("demand.topSearches")} hint={t("demand.catalogueViews", { count: f.n(d.catalogue_views) })}>
          <Table name={t("demand.topSearches")} exportLabel={t("common.export")} empty={t("common.nothingYet")}
            columns={[{ key: "q", label: t("demand.cols.query") }, { key: "n", label: t("demand.cols.count"), num: true }, { key: "avg", label: t("demand.cols.avgResults"), num: true }, { key: "zero", label: t("demand.cols.zero"), num: true, hideBelow: "sm" }]}
            rows={d.top_searches.map((s) => row(s.q, { q: <span dir="auto">{s.q}</span>, n: f.n(s.n), avg: f.n(s.avg_results), zero: f.n(s.zero) }, [s.q, s.n, s.avg_results, s.zero]))} />
        </Section>
        <Section title={t("demand.zeroSearches")}>
          <Table name={t("demand.zeroSearches")} exportLabel={t("common.export")} empty={t("common.none")}
            columns={[{ key: "q", label: t("demand.cols.query") }, { key: "n", label: t("demand.cols.count"), num: true }]}
            rows={d.zero_searches.map((s) => row(s.q, { q: <span dir="auto">{s.q}</span>, n: f.n(s.n) }, [s.q, s.n]))} />
        </Section>
        <Section title={t("demand.filters")}>
          <Card>
            {d.filters.length === 0 ? <p className="text-[13px] text-muted">{t("common.nothingYet")}</p> : <BarList items={d.filters.map((x) => ({ label: filterName(x.filter), value: x.n }))} format={f.n} />}
          </Card>
        </Section>
        <Section title={t("demand.sorts")}>
          <Card>
            {d.sorts.length === 0 ? <p className="text-[13px] text-muted">{t("common.nothingYet")}</p> : <BarList items={d.sorts.map((x) => ({ label: sortName(x.sort), value: x.n }))} format={f.n} />}
          </Card>
        </Section>
      </Grid>

      <Section title={t("demand.topListings")} hint={t("common.sinceEvents")}>
        <Table name={t("demand.topListings")} exportLabel={t("common.export")} empty={t("common.nothingYet")}
          columns={[
            { key: "title", label: t("marketplace.cols.title") }, { key: "views", label: t("demand.cols.views"), num: true }, { key: "uniq", label: t("demand.cols.uniqueViewers"), num: true, hideBelow: "sm" },
            { key: "reveals", label: t("demand.cols.reveals"), num: true }, { key: "fav", label: t("demand.cols.favourites"), num: true, hideBelow: "sm" }, { key: "visits", label: t("demand.cols.visits"), num: true, hideBelow: "sm" },
            { key: "price", label: t("demand.cols.price"), num: true, hideBelow: "md" },
          ]}
          rows={d.top_listings.map((l) => row(l.id, {
            title: (
              <span className="block min-w-0">
                <Link href={`/admin/annonces?q=${encodeURIComponent(l.reference ?? l.title)}` as never} className="line-clamp-1 font-semibold hover:underline" dir="auto">{l.title}</Link>
                <span className="block text-[11px] text-subtle">{l.reference} · {t(`marketplace.statuses.${l.status}`)} · {l.governorate}</span>
              </span>
            ),
            views: f.n(l.views), uniq: f.n(l.unique_viewers), reveals: f.n(l.reveals), fav: f.n(l.favourites), visits: f.n(l.visits), price: l.price === null ? "—" : f.money(l.price),
          }, [l.reference, l.title, l.status, l.governorate, l.views, l.unique_viewers, l.reveals, l.favourites, l.visits, l.price]))} />
      </Section>

      <Section title={t("demand.topAgences")}>
        <Table name={t("demand.topAgences")} exportLabel={t("common.export")} empty={t("common.nothingYet")}
          columns={[
            { key: "name", label: t("common.name") }, { key: "views", label: t("demand.cols.views"), num: true }, { key: "contacts", label: t("demand.cols.contacts"), num: true },
            { key: "online", label: t("demand.cols.listingsOnline"), num: true, hideBelow: "sm" }, { key: "lviews", label: t("demand.cols.listingViews"), num: true, hideBelow: "sm" },
            { key: "reveals", label: t("demand.cols.reveals"), num: true }, { key: "visits", label: t("demand.cols.visits"), num: true, hideBelow: "md" },
          ]}
          rows={d.top_agences.map((a) => row(a.id, {
            name: (
              <span className="block min-w-0">
                <Link href={`/admin/agences?id=${a.id}` as never} className="line-clamp-1 font-semibold hover:underline" dir="auto">{a.name}</Link>
                <span className="block text-[11px] text-subtle">{t.has(`pro.kinds.${a.kind}`) ? t(`pro.kinds.${a.kind}`) : a.kind} · {a.governorate}</span>
              </span>
            ),
            views: f.n(a.views), contacts: f.n(a.contacts), online: f.n(a.listings_online), lviews: f.n(a.listing_views), reveals: f.n(a.reveals), visits: f.n(a.visits),
          }, [a.name, a.kind, a.governorate, a.views, a.contacts, a.listings_online, a.listing_views, a.reveals, a.visits]))} />
      </Section>

      <Grid>
        <Section title={t("demand.visits")}>
          <Card>
            <Facts items={[
              { label: t("demand.visitKeys.total"), value: f.n(d.visits.total) },
              { label: t("demand.visitKeys.waiting"), value: f.n(d.visits.waiting), tone: d.visits.waiting > 0 ? "warn" : undefined },
              { label: t("demand.visitKeys.confirmed"), value: f.n(d.visits.confirmed) },
              { label: t("demand.visitKeys.declined"), value: f.n(d.visits.declined) },
              { label: t("demand.visitKeys.done"), value: f.n(d.visits.done) },
              { label: t("demand.visitKeys.cancelled"), value: f.n(d.visits.cancelled) },
              { label: t("demand.visitKeys.fast", { hours: rules.hours }), value: `${f.n(d.visits.fast)} · ${f.pct(rate(d.visits.fast, d.visits.answered + d.visits.late))}` },
              { label: t("demand.visitKeys.late"), value: f.n(d.visits.late), tone: d.visits.late > 0 ? "bad" : undefined },
              { label: t("demand.visitKeys.avg_answer_hours"), value: f.hours(d.visits.avg_answer_hours) },
              { label: t("demand.visitKeys.median_answer_hours"), value: f.hours(d.visits.median_answer_hours) },
            ]} />
          </Card>
        </Section>
        <Section title={t("demand.compare")}>
          <Card>
            <Facts items={[
              { label: t("demand.compareKeys.adds"), value: f.n(d.compare.adds) },
              { label: t("demand.compareKeys.users"), value: f.n(d.compare.users) },
              { label: t("demand.compareKeys.opens"), value: f.n(d.compare.opens) },
              { label: `${t("demand.credit")} · ${t("demand.creditKeys.opens")}`, value: f.n(d.credit_simulator.opens) },
              { label: `${t("demand.credit")} · ${t("demand.creditKeys.uses")}`, value: f.n(d.credit_simulator.uses) },
              { label: t("kpi.demandes"), value: f.n(d.demandes) },
            ]} />
          </Card>
        </Section>
      </Grid>

      <Section title={t("demand.visitsByAgence")}>
        <Table name={t("demand.visitsByAgence")} exportLabel={t("common.export")} empty={t("common.none")}
          columns={[
            { key: "name", label: t("common.name") }, { key: "total", label: t("demand.cols.total"), num: true }, { key: "answered", label: t("demand.cols.answered"), num: true },
            { key: "fast", label: t("demand.cols.fast", { hours: rules.hours }), num: true }, { key: "late", label: t("demand.cols.late"), num: true, hideBelow: "sm" },
            { key: "avg", label: t("demand.cols.avgHours"), num: true, hideBelow: "sm" }, { key: "rate", label: t("demand.cols.rate"), num: true }, { key: "badge", label: t("demand.cols.badge"), hideBelow: "md" },
          ]}
          rows={d.visits_by_agence.map((a) => {
            const judged = a.answered + a.late;
            const r = rate(a.fast, judged);
            const badge = judged < rules.minRequests ? t("demand.tooFew") : r !== null && r >= rules.minRate ? t("demand.reactive") : t("demand.notReactive");
            return row(a.id, {
              name: <Link href={`/admin/agences?id=${a.id}` as never} className="font-semibold hover:underline" dir="auto">{a.name}</Link>,
              total: f.n(a.total), answered: f.n(a.answered), fast: f.n(a.fast), late: f.n(a.late), avg: f.hours(a.avg_hours), rate: f.pct(r),
              badge: <span className={judged >= rules.minRequests && r !== null && r < rules.minRate ? "font-semibold text-[var(--tone-bad)]" : "text-muted"}>{badge}</span>,
            }, [a.name, a.total, a.answered, a.fast, a.late, a.avg_hours, r, badge]);
          })} />
      </Section>
    </>
  );
}
