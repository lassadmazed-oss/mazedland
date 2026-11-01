import type { SupabaseClient } from "@supabase/supabase-js";
import { getTranslations } from "next-intl/server";
import type { Settings } from "@/lib/settings/registry";
import type { Period } from "@/lib/analytics/period";
import { rate, retention } from "@/lib/analytics/shape";
import * as q from "@/lib/analytics/queries";
import { formatters } from "../format";
import { BarList, StackedBars } from "../Charts";
import { Card, Facts, Grid, KpiTile, Section, Table, type TableRow } from "../ui";

/** The accounts: who signs up, from where, and whether they come back. */
export async function UsersSection({ admin, period, locale }: { admin: SupabaseClient; period: Period; settings: Settings; locale: string }) {
  const t = await getTranslations("adminAnalytics");
  const f = formatters(locale, t("common.tnd"));
  const u = await q.users(admin, period);
  const row = (key: string, cells: Record<string, React.ReactNode>, csv: (string | number | null)[]): TableRow => ({ _key: key, _csv: csv, ...cells });
  const name = (ns: "locales" | "devices" | "roles", k: string) => (t.has(`users.${ns}.${k}`) ? t(`users.${ns}.${k}`) : k);
  const consentRate = rate(u.consent.granted, u.consent.granted + u.consent.denied);
  const installRate = rate(u.install.done, u.install.shown);

  return (
    <>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiTile label={t("users.signups")} value={f.n(u.signups)} />
        <KpiTile label={t("users.logins")} value={f.n(u.logins)} />
        <KpiTile label={t("users.activeKeys.period")} value={f.n(u.active.period)} />
        <KpiTile label={t("users.activeKeys.d30")} value={f.n(u.active.d30)} />
        <KpiTile label={t("users.total")} value={f.n(u.accounts_total)} />
        <KpiTile label={t("users.deleted")} value={f.n(u.deleted)} invert />
      </div>

      <Section title={t("users.byDay")}>
        <Card>
          {u.signups_by_day.length === 0 ? <p className="text-[13px] text-muted">{t("common.empty")}</p> : (
            <StackedBars labels={u.signups_by_day.map((d) => f.day(d.day))} stacks={[{ name: t("users.cols.fr"), values: u.signups_by_day.map((d) => d.fr) }, { name: t("users.cols.ar"), values: u.signups_by_day.map((d) => d.ar) }, { name: t("users.cols.other"), values: u.signups_by_day.map((d) => d.other) }]} format={f.n} />
          )}
        </Card>
      </Section>

      <Grid cols={3}>
        <Section title={t("users.byLocale")}>
          <Card><BarList items={Object.entries(u.by_locale).map(([k, n]) => ({ label: name("locales", k), value: n }))} format={f.n} /></Card>
        </Section>
        <Section title={t("users.byRole")}>
          <Card><BarList items={Object.entries(u.by_role).map(([k, n]) => ({ label: name("roles", k), value: n }))} format={f.n} /></Card>
        </Section>
        <Section title={t("users.byDevice")}>
          <Card>
            {Object.keys(u.by_device).length === 0 ? <p className="text-[13px] text-muted">{t("common.nothingYet")}</p> : <BarList items={Object.entries(u.by_device).map(([k, n]) => ({ label: name("devices", k), value: n }))} format={f.n} />}
          </Card>
        </Section>
      </Grid>

      <Section title={t("users.cohorts")} hint={t("users.cohortHint")}>
        <Table name={t("users.cohorts")} exportLabel={t("common.export")} empty={t("common.empty")}
          columns={[{ key: "week", label: t("users.cohortCols.week") }, { key: "size", label: t("users.cohortCols.size"), num: true }, { key: "w1", label: t("users.cohortCols.w1"), num: true }, { key: "w4", label: t("users.cohortCols.w4"), num: true }]}
          rows={u.cohorts.map((c) => {
            const r1 = retention(c.w1, c.size);
            const r4 = retention(c.w4, c.size);
            return row(c.from, {
              week: `${f.day(c.from)} → ${f.day(c.to)}`, size: f.n(c.size),
              w1: r1 === null ? "—" : `${f.n(c.w1)} · ${f.pct(r1)}`, w4: r4 === null ? "—" : `${f.n(c.w4)} · ${f.pct(r4)}`,
            }, [c.from, c.to, c.size, c.w1, r1, c.w4, r4]);
          })} />
      </Section>

      <Grid cols={3}>
        <Section title={t("users.consent")}>
          <Card>
            <Facts items={[
              { label: t("users.consentKeys.granted"), value: f.n(u.consent.granted) },
              { label: t("users.consentKeys.denied"), value: f.n(u.consent.denied) },
              { label: t("users.consentKeys.rate"), value: f.pct(consentRate) },
            ]} />
          </Card>
        </Section>
        <Section title={t("users.install")}>
          <Card>
            <Facts items={[
              { label: t("users.installKeys.shown"), value: f.n(u.install.shown) },
              { label: t("users.installKeys.click"), value: f.n(u.install.click) },
              { label: t("users.installKeys.done"), value: f.n(u.install.done) },
              { label: t("users.installKeys.rate"), value: f.pct(installRate) },
            ]} />
          </Card>
        </Section>
        <Section title={t("users.errors")}>
          <Card>
            <Facts items={[
              { label: t("users.errorKeys.not_found"), value: f.n(u.errors.not_found), tone: u.errors.not_found > 0 ? "warn" : undefined },
              { label: t("users.errorKeys.client"), value: f.n(u.errors.client), tone: u.errors.client > 0 ? "warn" : undefined },
              { label: t("users.errorKeys.uploads"), value: f.n(u.errors.uploads), tone: u.errors.uploads > 0 ? "warn" : undefined },
              { label: t("users.languageSwitches"), value: f.n(u.language_switches) },
            ]} />
          </Card>
        </Section>
      </Grid>

      <Grid>
        <Section title={t("users.byLocaleEvents")}>
          <Card>
            {Object.keys(u.by_locale_events).length === 0 ? <p className="text-[13px] text-muted">{t("common.nothingYet")}</p> : <BarList items={Object.entries(u.by_locale_events).map(([k, n]) => ({ label: name("locales", k), value: n }))} format={f.n} />}
          </Card>
        </Section>
        <Section title={t("users.byDeviceEvents")}>
          <Card>
            {Object.keys(u.by_device_events).length === 0 ? <p className="text-[13px] text-muted">{t("common.nothingYet")}</p> : <BarList items={Object.entries(u.by_device_events).map(([k, n]) => ({ label: name("devices", k), value: n }))} format={f.n} />}
          </Card>
        </Section>
      </Grid>
    </>
  );
}
