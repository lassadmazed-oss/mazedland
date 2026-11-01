import { requireAdmin } from "@/lib/admin/session";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings/server";
import { formatDate } from "@/lib/utils";
import { periodQuery, resolvePeriod, tunisDay } from "@/lib/analytics/period";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { PeriodPicker } from "@/components/admin/analytics/PeriodPicker";
import { Overview } from "@/components/admin/analytics/sections/Overview";
import { Traffic } from "@/components/admin/analytics/sections/Traffic";
import { Marketplace } from "@/components/admin/analytics/sections/Marketplace";
import { Demand } from "@/components/admin/analytics/sections/Demand";
import { ProRevenue } from "@/components/admin/analytics/sections/ProRevenue";
import { UsersSection } from "@/components/admin/analytics/sections/UsersSection";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Statistiques — how the marketplace is doing, at a glance and in depth.
 *
 * Six parts, one period: what to retain and the figures (Overview), what
 * Google sees (Traffic), what is online and how it got there (Marketplace),
 * what people look for and whom they contact (Demand), the agences and the
 * money (Pro & revenue), the accounts and whether they come back (Users).
 * Every figure comes from the database's own aggregations (0204) over the
 * tables the site writes as it runs, plus the site's own events; nothing is
 * entered by hand. Each tab fetches only what it shows, in parallel.
 */
const TABS = ["overview", "traffic", "marketplace", "demand", "pro", "users"] as const;
type Tab = (typeof TABS)[number];

/** The tab's title: every page of this section used to carry the site's home title. */
export async function generateMetadata() {
  const t = await getTranslations("adminAnalytics");
  return { title: t("title") };
}

export default async function AdminAnalyticsPage({ searchParams }: { searchParams: Promise<{ tab?: string; p?: string; from?: string; to?: string }> }) {
  await requireAdmin("analytics");
  const sp = await searchParams;
  const t = await getTranslations("adminAnalytics");
  const locale = await getLocale();
  const admin = getServiceSupabase();
  if (!admin) return <p className="p-6 text-[13px] text-muted">{t("unavailable")}</p>;
  const settings = await getSettings();
  const period = resolvePeriod(sp);
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "overview";
  const range = t("period.range", { from: formatDate(period.from, locale, "medium"), to: formatDate(new Date(period.to.getTime() - 1), locale, "medium") });

  return (
    <div>
      <AdminPageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker current={period.key} fromDay={period.fromDay} toDay={period.toDay} today={tunisDay(new Date())} tab={tab} />
        <p className="mazed-tabular text-[12px] text-subtle">
          {range} · {t("period.compared", { days: period.days })}
        </p>
      </div>
      {period.fellBack && (
        <p role="status" className="mt-3 rounded-xl bg-[var(--tone-warn-bg)] px-3 py-2 text-[12px] font-semibold text-[var(--tone-warn)] ring-1 ring-[var(--tone-warn-ring)]">
          {t("period.fallback")}
        </p>
      )}

      <nav aria-label={t("tabs.label")} className="-mx-5 mt-4 flex items-center gap-4 overflow-x-auto border-b border-border px-5 lg:-mx-8 lg:px-8">
        {TABS.map((k) => (
          <Link
            key={k}
            href={`/admin/analytics${periodQuery(period, k === "overview" ? {} : { tab: k })}` as never}
            aria-current={k === tab ? "page" : undefined}
            className={`relative shrink-0 py-2.5 text-[12.5px] transition ${
              k === tab
                ? "font-semibold text-[var(--gold)] after:absolute after:inset-x-0 after:bottom-[-1px] after:h-[2px] after:bg-[var(--gold)]"
                : "font-medium text-subtle hover:text-foreground"
            }`}
          >
            {t(`tabs.${k}`)}
          </Link>
        ))}
      </nav>

      {tab === "overview" && <Overview admin={admin} period={period} settings={settings} locale={locale} />}
      {tab === "traffic" && <Traffic admin={admin} period={period} settings={settings} locale={locale} />}
      {tab === "marketplace" && <Marketplace admin={admin} period={period} settings={settings} locale={locale} />}
      {tab === "demand" && <Demand admin={admin} period={period} settings={settings} locale={locale} />}
      {tab === "pro" && <ProRevenue admin={admin} period={period} settings={settings} locale={locale} />}
      {tab === "users" && <UsersSection admin={admin} period={period} settings={settings} locale={locale} />}
    </div>
  );
}
