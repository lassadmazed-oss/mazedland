import type { SupabaseClient } from "@supabase/supabase-js";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Settings } from "@/lib/settings/registry";
import type { Period } from "@/lib/analytics/period";
import * as q from "@/lib/analytics/queries";
import { formatters } from "../format";
import { BarList, Bars } from "../Charts";
import { Card, Facts, Grid, KpiTile, Section, Table, type TableRow } from "../ui";

/** Pro & revenue: the agences by plan, the money in, the documents, the offers. */
export async function ProRevenue({ admin, period, locale }: { admin: SupabaseClient; period: Period; settings: Settings; locale: string }) {
  const t = await getTranslations("adminAnalytics");
  const f = formatters(locale, t("common.tnd"));
  const [p, series] = await Promise.all([q.pro(admin, period), q.series(admin, period)]);
  const row = (key: string, cells: Record<string, React.ReactNode>, csv: (string | number | null)[]): TableRow => ({ _key: key, _csv: csv, ...cells });
  const planName = (x: { name_fr: string; name_ar: string | null }) => (locale === "ar" && x.name_ar ? x.name_ar : x.name_fr);
  const label = (ns: string, k: string) => (t.has(`pro.${ns}.${k}`) ? t(`pro.${ns}.${k}`) : k);
  const captured = p.payments.find((x) => x.status === "captured");

  return (
    <>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiTile label={t("pro.mrr")} value={f.money(p.mrr)} hint={t("pro.mrrOffered", { amount: f.n(p.mrr_offered) })} />
        <KpiTile label={t("kpi.revenue")} value={f.money(captured?.amount ?? 0)} />
        <KpiTile label={t("kpi.paid_count")} value={f.n(captured?.n ?? 0)} />
        <KpiTile label={t("pro.pendingNow")} value={f.n(p.pending_now.n)} hint={f.money(p.pending_now.amount)} />
        <KpiTile label={t("pro.agenceKeys.approved")} value={f.n(p.agences.approved)} />
        <KpiTile label={t("pro.noPlan")} value={f.n(p.no_plan)} />
      </div>
      {p.ending_soon > 0 && <p className="mt-3 text-[12.5px] font-semibold text-[var(--tone-warn)]">{t("pro.endingSoon", { count: f.n(p.ending_soon) })}</p>}

      <Grid>
        <Section title={t("pro.byPlan")}>
          <Table name={t("pro.byPlan")} exportLabel={t("common.export")} empty={t("common.none")}
            columns={[{ key: "plan", label: t("pro.cols.plan") }, { key: "price", label: t("pro.cols.price"), num: true }, { key: "quota", label: t("pro.cols.quota"), num: true, hideBelow: "sm" }, { key: "agences", label: t("pro.cols.agences"), num: true }, { key: "offered", label: t("pro.cols.offered"), num: true }]}
            rows={p.by_plan.map((x) => row(x.slug, { plan: planName(x), price: f.money(x.price), quota: f.n(x.quota), agences: f.n(x.agences), offered: f.n(x.offered) }, [planName(x), x.price, x.quota, x.agences, x.offered]))} />
        </Section>
        <Section title={t("pro.agences")}>
          <Card>
            <Facts items={[
              ...(["approved", "pending", "suspended", "rejected", "verified", "new"] as const).map((k) => ({ label: t(`pro.agenceKeys.${k}`), value: f.n(p.agences[k]), tone: k === "pending" && p.agences[k] > 0 ? ("warn" as const) : undefined })),
              ...Object.entries(p.agences.by_kind).map(([k, n]) => ({ label: label("kinds", k), value: f.n(n), tone: undefined })),
            ]} />
          </Card>
        </Section>
      </Grid>

      <Section title={t("kpi.revenue")} hint={t("charts.daily")}>
        <Card>
          <Bars labels={series.map((d) => f.day(d.day))} values={series.map((d) => d.revenue)} format={f.n} />
        </Card>
      </Section>

      <Grid cols={3}>
        <Section title={t("pro.payments")}>
          <Table name={t("pro.payments")} exportLabel={t("common.export")} empty={t("common.none")}
            columns={[{ key: "status", label: t("pro.cols.status") }, { key: "n", label: t("pro.cols.count"), num: true }, { key: "amount", label: t("pro.cols.amount"), num: true }]}
            rows={p.payments.map((x) => row(x.status, { status: <Link href={"/admin/paiements" as never} className="hover:underline">{label("paymentStatus", x.status)}</Link>, n: f.n(x.n), amount: f.money(x.amount) }, [label("paymentStatus", x.status), x.n, x.amount]))} />
        </Section>
        <Section title={t("pro.revenueByKind")}>
          <Table name={t("pro.revenueByKind")} exportLabel={t("common.export")} empty={t("common.none")}
            columns={[{ key: "kind", label: t("pro.cols.kind") }, { key: "n", label: t("pro.cols.count"), num: true }, { key: "amount", label: t("pro.cols.amount"), num: true }]}
            rows={p.revenue_by_kind.map((x) => row(x.kind, { kind: label("paymentKinds", x.kind), n: f.n(x.n), amount: f.money(x.amount) }, [label("paymentKinds", x.kind), x.n, x.amount]))} />
        </Section>
        <Section title={t("pro.revenueByProvider")}>
          <Table name={t("pro.revenueByProvider")} exportLabel={t("common.export")} empty={t("common.none")}
            columns={[{ key: "provider", label: t("pro.cols.provider") }, { key: "n", label: t("pro.cols.count"), num: true }, { key: "amount", label: t("pro.cols.amount"), num: true }]}
            rows={p.revenue_by_provider.map((x) => row(x.provider, { provider: label("providers", x.provider), n: f.n(x.n), amount: f.money(x.amount) }, [label("providers", x.provider), x.n, x.amount]))} />
        </Section>
      </Grid>

      <Grid>
        <Section title={t("pro.invoices")}>
          <Card>
            <Facts items={[
              { label: t("pro.invoiceKeys.invoices"), value: f.n(p.invoices.invoices) },
              { label: t("pro.invoiceKeys.invoices_amount"), value: f.money(p.invoices.invoices_amount) },
              { label: t("pro.invoiceKeys.credit_notes"), value: f.n(p.invoices.credit_notes), tone: p.invoices.credit_notes > 0 ? "warn" : undefined },
              { label: t("pro.invoiceKeys.credit_notes_amount"), value: f.money(p.invoices.credit_notes_amount) },
            ]} />
          </Card>
        </Section>
        <Section title={t("pro.planChanges")}>
          <Card>
            {p.plan_changes.length === 0 ? <p className="text-[13px] text-muted">{t("common.none")}</p> : (
              <BarList items={p.plan_changes.map((x) => ({ label: planName(x), value: x.paid + x.offered, sub: `${t("pro.cols.paid")} ${f.n(x.paid)} · ${t("pro.cols.offered")} ${f.n(x.offered)}` }))} format={f.n} />
            )}
            <p className="mt-3 text-[12px] text-muted">{t("pro.offers")} : <span className="mazed-tabular font-bold text-foreground">{f.n(p.offers)}</span></p>
          </Card>
        </Section>
      </Grid>

      <Grid cols={3}>
        <Section title={t("pro.imports")}>
          <Card>
            <Facts items={[{ label: t("pro.cols.files"), value: f.n(p.imports.files) }, { label: t("pro.cols.rows"), value: f.n(p.imports.rows) }]} />
          </Card>
        </Section>
        <Section title={t("pro.social")} hint={t("pro.socialRevenue", { amount: f.n(p.social_revenue) })}>
          <Card>
            {p.social.length === 0 ? <p className="text-[13px] text-muted">{t("common.none")}</p> : <Facts items={p.social.map((x) => ({ label: label("socialStatus", x.status), value: f.n(x.n) }))} />}
          </Card>
        </Section>
        <Section title={t("pro.ai")}>
          <Card>
            <Facts items={[{ label: t("pro.cols.calls"), value: f.n(p.ai.calls) }, { label: t("pro.cols.failed"), value: f.n(p.ai.failed), tone: p.ai.failed > 0 ? "warn" : undefined }, { label: t("pro.cols.cost"), value: f.dec2(p.ai.cost_usd) }]} />
          </Card>
        </Section>
      </Grid>
    </>
  );
}
