import type { SupabaseClient } from "@supabase/supabase-js";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Settings } from "@/lib/settings/registry";
import type { Period } from "@/lib/analytics/period";
import { bandLabel, bandTable, funnelSteps, RENT_BANDS, SALE_BANDS } from "@/lib/analytics/shape";
import { formatDate } from "@/lib/utils";
import * as q from "@/lib/analytics/queries";
import { formatters } from "../format";
import { BarList, Funnel, StackedBars } from "../Charts";
import { Card, Empty, Facts, Grid, Section, Table, type TableRow } from "../ui";

const STATUSES = ["published", "pending_review", "pending_payment", "draft", "rejected", "expired", "archived", "sold", "rented"] as const;

/** The marketplace: what is online, where, at what price, how it got there. */
export async function Marketplace({ admin, period, settings, locale }: { admin: SupabaseClient; period: Period; settings: Settings; locale: string }) {
  const t = await getTranslations("adminAnalytics");
  const f = formatters(locale, t("common.tnd"));
  const [m, series] = await Promise.all([q.marketplace(admin, period, settings.analytics_expiring_days), q.series(admin, period)]);
  const row = (key: string, cells: Record<string, React.ReactNode>, csv: (string | number | null)[]): TableRow => ({ _key: key, _csv: csv, ...cells });
  const catLabel = (c: { label_fr: string; label_ar: string | null }) => (locale === "ar" && c.label_ar ? c.label_ar : c.label_fr);
  const bands = bandTable(m.price_bands);
  const catBySlug = new Map(m.by_category.map((c) => [c.slug, c]));
  const steps = funnelSteps([
    { key: "start", value: m.funnel.start }, { key: "category", value: m.funnel.category }, { key: "photos", value: m.funnel.photos },
    { key: "details", value: m.funnel.details }, { key: "review", value: m.funnel.review }, { key: "submitted", value: m.funnel.submitted }, { key: "published", value: m.funnel.published },
  ]);

  return (
    <>
      <Grid>
        <Section title={t("marketplace.byStatus")}>
          <Card>
            <BarList items={STATUSES.filter((s) => m.by_status[s]).map((s) => ({ label: t(`marketplace.statuses.${s}`), value: m.by_status[s] ?? 0 }))} format={f.n} />
          </Card>
        </Section>
        <Section title={t("marketplace.byDeal")}>
          <Card>
            <Facts items={m.by_deal.flatMap((d) => [
              { label: `${t(`common.${d.deal === "rent" ? "rent" : "sale"}`)} · ${t("marketplace.cols.online")}`, value: f.n(d.online) },
              { label: `${t(`common.${d.deal === "rent" ? "rent" : "sale"}`)} · ${t("marketplace.cols.published")}`, value: f.n(d.published) },
              { label: `${t(`common.${d.deal === "rent" ? "rent" : "sale"}`)} · ${t("marketplace.cols.new")}`, value: f.n(d.new) },
            ])} />
          </Card>
          <div className="mt-4">
            <Card>
              <p className="text-[12px] font-semibold text-muted">{t("kpi.publishes")} · {t("kpi.listings_new")}</p>
              <div className="mt-2">
                <StackedBars labels={series.map((d) => f.day(d.day))} stacks={[{ name: t("kpi.publishes"), values: series.map((d) => d.publishes) }, { name: t("kpi.listings_new"), values: series.map((d) => Math.max(0, d.listings_new - d.publishes)) }]} format={f.n} />
              </div>
            </Card>
          </div>
        </Section>
      </Grid>

      <Section title={t("marketplace.byCategory")}>
        <Table name={t("marketplace.byCategory")} exportLabel={t("common.export")} empty={t("common.empty")}
          columns={[
            { key: "cat", label: t("common.category") }, { key: "online", label: t("marketplace.cols.online"), num: true }, { key: "published", label: t("marketplace.cols.published"), num: true },
            { key: "views", label: t("marketplace.cols.views"), num: true, hideBelow: "sm" }, { key: "reveals", label: t("marketplace.cols.reveals"), num: true, hideBelow: "sm" },
            { key: "medianSale", label: t("marketplace.cols.medianSale"), num: true, hideBelow: "md" }, { key: "medianRent", label: t("marketplace.cols.medianRent"), num: true, hideBelow: "md" },
          ]}
          rows={m.by_category.map((c) => row(c.slug, {
            cat: <Link href={`/admin/annonces?cat=${encodeURIComponent(c.slug)}` as never} className="font-semibold hover:underline">{catLabel(c)}</Link>,
            online: f.n(c.online), published: f.n(c.published), views: f.n(c.views), reveals: f.n(c.reveals),
            medianSale: c.median_sale === null ? "—" : f.money(c.median_sale), medianRent: c.median_rent === null ? "—" : f.money(c.median_rent),
          }, [catLabel(c), c.online, c.published, c.views, c.reveals, c.median_sale, c.median_rent]))} />
      </Section>

      <Section title={t("marketplace.byGovernorate")}>
        <Table name={t("marketplace.byGovernorate")} exportLabel={t("common.export")} empty={t("common.empty")}
          columns={[
            { key: "gov", label: t("common.governorate") }, { key: "online", label: t("marketplace.cols.online"), num: true }, { key: "published", label: t("marketplace.cols.published"), num: true, hideBelow: "sm" },
            { key: "views", label: t("marketplace.cols.views"), num: true }, { key: "searches", label: t("marketplace.cols.searches"), num: true },
            { key: "reveals", label: t("marketplace.cols.reveals"), num: true, hideBelow: "sm" }, { key: "demandes", label: t("marketplace.cols.demandes"), num: true, hideBelow: "md" },
          ]}
          rows={m.by_governorate.map((g) => row(g.gov, {
            gov: <Link href={`/admin/annonces?gov=${encodeURIComponent(g.gov)}` as never} className="font-semibold hover:underline">{g.gov}</Link>,
            online: f.n(g.online), published: f.n(g.published), views: f.n(g.views), searches: f.n(g.searches), reveals: f.n(g.reveals), demandes: f.n(g.demandes),
          }, [g.gov, g.online, g.published, g.views, g.searches, g.reveals, g.demandes]))} />
      </Section>

      <Section title={t("marketplace.priceBands")}>
        {bands.length === 0 ? <Empty text={t("common.empty")} /> : (
          <div className="grid gap-4 lg:grid-cols-2">
            {bands.map((b) => {
              const def: readonly { band: number }[] = b.deal === "rent" ? RENT_BANDS : SALE_BANDS;
              const cat = catBySlug.get(b.category);
              return (
                <Card key={`${b.category}-${b.deal}`}>
                  <p className="text-[12.5px] font-bold text-foreground">{cat ? catLabel(cat) : b.category} · {t(`common.${b.deal}`)} <span className="font-normal text-subtle">({f.n(b.total)})</span></p>
                  <div className="mt-2">
                    <BarList items={def.map((d, i) => ({ label: bandLabel(b.deal, d.band, f.n), value: b.bands[i] }))} format={f.n} />
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </Section>

      <Grid>
        <Section title={t("marketplace.timeToPublish")}>
          <Card>
            {m.time_to_publish.n === 0 ? <p className="text-[13px] text-muted">{t("marketplace.ttp.none")}</p> : (
              <Facts items={[
                { label: t("marketplace.ttp.medianLabel"), value: t("common.hours", { count: f.hours(m.time_to_publish.median_hours) }) },
                { label: t("marketplace.ttp.avgLabel"), value: t("common.hours", { count: f.hours(m.time_to_publish.avg_hours) }) },
                { label: t("kpi.publishes"), value: f.n(m.time_to_publish.n) },
              ]} />
            )}
          </Card>
        </Section>
        <Section title={t("marketplace.moderation")}>
          <Card>
            <Facts items={(["submitted", "auto_published", "approved", "rejected", "edits_approved", "edits_rejected", "archived", "reports", "pending_now"] as const).map((k) => ({
              label: t(`marketplace.moderationKeys.${k}`), value: f.n(m.moderation[k]), tone: k === "pending_now" && m.moderation[k] > 0 ? "warn" as const : undefined,
            })).concat([{ label: t("marketplace.moderationKeys.review_median_hours"), value: f.hours(m.moderation.review_median_hours), tone: undefined }])} />
          </Card>
        </Section>
      </Grid>

      <Section title={t("marketplace.funnel")} hint={t("marketplace.funnelNote", { abandoned: f.n(m.funnel.abandoned), drafts: f.n(m.funnel.drafts) })}>
        <Card>
          <Funnel steps={steps.map((s) => ({ label: t(`marketplace.funnelSteps.${s.key}`), value: f.n(s.value), share: s.share, drop: s.drop === null ? null : t("marketplace.drop", { pct: s.drop }) }))} />
        </Card>
      </Section>

      <Section title={t("marketplace.quality")}>
        <Grid>
          <Card>
            <Facts items={[
              { label: t("marketplace.qualityKeys.online"), value: f.n(m.quality.online) },
              { label: t("marketplace.qualityKeys.no_photo"), value: <Link href={"/admin/annonces?status=published" as never} className="hover:underline">{f.n(m.quality.no_photo)}</Link>, tone: m.quality.no_photo > 0 ? "warn" : undefined },
              { label: t("marketplace.qualityKeys.no_price"), value: f.n(m.quality.no_price), tone: m.quality.no_price > 0 ? "warn" : undefined },
              { label: t("marketplace.qualityKeys.expiring", { days: settings.analytics_expiring_days }), value: <Link href={"/admin/annonces?status=expiring" as never} className="hover:underline">{f.n(m.quality.expiring)}</Link>, tone: m.quality.expiring > 0 ? "warn" : undefined },
            ]} />
          </Card>
          <div>
            <p className="mb-2 text-[12px] font-semibold text-muted">{t("marketplace.expiringList")}</p>
            <Table name={t("marketplace.expiringList")} exportLabel={t("common.export")} empty={t("common.none")}
              columns={[{ key: "ref", label: t("marketplace.cols.reference") }, { key: "title", label: t("marketplace.cols.title") }, { key: "expires", label: t("marketplace.cols.expires") }]}
              rows={m.quality.expiring_list.map((l) => row(l.id, {
                ref: <Link href={`/admin/annonces?q=${encodeURIComponent(l.reference ?? "")}` as never} className="font-semibold hover:underline">{l.reference ?? "—"}</Link>,
                title: <span className="line-clamp-1" dir="auto">{l.title}</span>, expires: formatDate(l.expires_at, locale, "short"),
              }, [l.reference, l.title, l.expires_at.slice(0, 10)]))} />
          </div>
        </Grid>
      </Section>
    </>
  );
}
