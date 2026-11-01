import { requireAdmin } from "@/lib/admin/session";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { settingsFromRows } from "@/lib/settings/server";
import { SETTINGS, type SettingKey } from "@/lib/settings/registry";
import { isSmsConfigured } from "@/lib/winsms";
import { anyPhoneToE164 } from "@/lib/tunisia";
import { tunisDay } from "@/lib/visits";
import { formatDate, formatNumber, formatRelativeTime } from "@/lib/utils";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { SiteTabs } from "@/components/admin/kit/SiteTabs";
import { SidePanel, StatusPill, EmptyState, EYEBROW, NUM, type Tone } from "@/components/admin/kit";
import { adminBtn } from "@/components/admin/AdminButton";
import { SettingsPanel } from "../settings/SettingsPanel";
import { ServiceEditor, type EditableService } from "./ServiceEditor";
import { CheckNowButton, ServiceActions, TestSmsButton } from "./ServiceButtons";
import {
  SERVICE_STATES, monthlyTotals, serviceState, type PaidService, type ServiceState,
} from "@/lib/services/services";
import { CreditCard, ExternalLink, Plus, RadioTower } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Abonnements — every paid thing the site lives on (0203): Vercel, Supabase,
 * the domains, the SMS credit, the AI. Each row says when it renews, what it
 * costs and which account pays it; the colour says whether to worry.
 *
 * What a provider can tell is read from it every hour (/api/cron/services):
 * Vercel's billing period and block, a domain's expiry, the WinSMS credit and
 * licence. The rest the owner fills in, mostly with chips. Below the list,
 * the SMS settings (the registry's `services_*`, the same form as
 * /admin/settings) and the last SMS sent.
 *
 * Owner-only: it names the accounts that pay.
 */

const BASE = "/admin/abonnements";
const SETTING_KEYS = (Object.keys(SETTINGS) as SettingKey[]).filter((k) => SETTINGS[k].group === "services");

type Alert = {
  id: number;
  service_id: string | null;
  stage: string;
  phone: string;
  status: "sending" | "sent" | "failed";
  error: string | null;
  created_at: string;
  sent_at: string | null;
};

const TONE: Record<ServiceState, Tone> = {
  blocked: "bad",
  unpaid: "bad",
  overdue: "bad",
  today: "warn",
  soon: "warn",
  low: "warn",
  error: "warn",
  unknown: "neutral",
  ok: "ok",
  paused: "neutral",
};

type Watch = {
  last_code: number | null;
  last_checked_at: string | null;
  incident: string | null;
  incident_since: string | null;
};

/** The tab's title: every page of this section used to carry the site's home title. */
export async function generateMetadata() {
  const t = await getTranslations("adminServices");
  return { title: t("title") };
}

export default async function AdminServicesPage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  await requireAdmin("abonnements");
  const sp = await searchParams;
  const t = await getTranslations("adminServices");
  const locale = await getLocale();
  const admin = getServiceSupabase();
  if (!admin) return <p className="p-6 text-[13px] text-muted">{t("unavailable")}</p>;

  const [services, alerts, watch, beat, settingRows] = await Promise.all([
    admin.from("paid_services").select("*").order("sort_order").order("created_at"),
    admin
      .from("paid_service_alerts")
      .select("id, service_id, stage, phone, status, error, created_at, sent_at")
      .order("created_at", { ascending: false })
      .limit(40),
    admin.from("services_watch").select("last_code, last_checked_at, incident, incident_since").eq("id", 1).maybeSingle(),
    admin.from("cron_heartbeat").select("last_run").eq("job", "services_watch").maybeSingle(),
    admin.from("app_settings").select("key, value").in("key", SETTING_KEYS),
  ]);
  if (services.error) return <p className="p-6 text-[13px] text-muted">{t("unavailable")}</p>;

  const rows = (settingRows.data ?? []) as { key: string; value: unknown }[];
  const settings = settingsFromRows(rows);
  const today = tunisDay();
  const lead = settings.services_lead_days;

  const all = ((services.data ?? []) as PaidService[])
    // numeric comes back as a string from some drivers: a total must add, not concatenate.
    .map((s) => ({ ...s, cost: s.cost === null ? null : Number(s.cost) }))
    .map((s) => ({ ...s, ...serviceState(s, today, lead) }))
    // Worst first; within one state, the order the owner set.
    .sort((a, b) => SERVICE_STATES.indexOf(a.state) - SERVICE_STATES.indexOf(b.state) || a.sort_order - b.sort_order);
  const log = (alerts.data ?? []) as Alert[];
  const nameOf = new Map(all.map((s) => [s.id, s.name]));

  const tally = { todo: 0, soon: 0, fine: 0 };
  for (const s of all) {
    const tone = TONE[s.state];
    if (tone === "bad") tally.todo += 1;
    else if (tone === "warn") tally.soon += 1;
    else if (tone === "ok") tally.fine += 1;
  }
  const totals = monthlyTotals(all);

  const phones = settings.services_sms_recipients;
  const valid = phones.filter((p) => anyPhoneToE164(p));
  const invalid = phones.filter((p) => !anyPhoneToE164(p));

  const money = (amount: number, currency: string) =>
    `${formatNumber(amount, locale, { maxDecimals: 2 })} ${currency === "USD" ? "$" : currency === "EUR" ? "€" : "DT"}`;
  const dayText = (day: string) => formatDate(`${day}T12:00:00Z`, locale, "medium");
  const ago = (iso: string) => formatRelativeTime(iso, locale);

  const stateText = (s: { state: ServiceState; days: number | null; provider: string }) => {
    const days = Math.abs(s.days ?? 0);
    if (s.state === "ok") return s.days === null ? t("state.okNoDate") : t("state.ok", { days });
    if (s.state === "overdue" || s.state === "soon") return t(`state.${s.state}`, { days });
    return t(`state.${s.state}`, { provider: s.provider });
  };
  const priceText = (s: PaidService) =>
    s.cost === null ? t("price.unknown") : t(`price.${s.cycle}`, { amount: money(s.cost, s.currency) });

  const openId = sp.s ?? null;
  const creating = openId === "new";
  const selected = creating ? null : all.find((s) => s.id === openId) ?? null;
  const accounts = [...new Set(all.map((s) => s.account).filter((a): a is string => Boolean(a)))];

  const watchRow = watch.data as Watch | null;
  const beatAt = (beat.data as { last_run: string } | null)?.last_run ?? null;

  return (
    <div>
      <SiteTabs />
      <AdminPageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
        actions={
          <div className="flex flex-wrap gap-2">
            <CheckNowButton />
            <Link href={`${BASE}?s=new` as typeof BASE} className={adminBtn("primary", "sm")}>
              <Plus className="size-3.5" strokeWidth={2.8} />
              {t("add")}
            </Link>
          </div>
        }
      />

      {(!settings.services_alerts_enabled || !isSmsConfigured() || valid.length === 0) && (
        <p className="mt-4 rounded-xl bg-[var(--tone-warn-bg)] px-4 py-2.5 text-[12.5px] text-[var(--tone-warn)]">
          {!isSmsConfigured() ? t("warn.smsOff") : !settings.services_alerts_enabled ? t("warn.alertsOff") : t("warn.noRecipients")}{" "}
          <a href="#alertes" className="font-semibold underline">
            {t("warn.fix")}
          </a>
        </p>
      )}

      <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {(
          [
            ["todo", tally.todo, "text-[var(--tone-bad)]"],
            ["soon", tally.soon, "text-[var(--tone-warn)]"],
            ["fine", tally.fine, "text-[var(--tone-ok)]"],
          ] as const
        ).map(([key, n, color]) => (
          <div key={key}>
            <dt className="text-[11.5px] text-subtle">{t(`summary.${key}`)}</dt>
            <dd className={`${NUM} mt-0.5 text-[22px] font-semibold leading-tight ${n > 0 ? color : "text-foreground"}`}>
              {formatNumber(n, locale)}
            </dd>
          </div>
        ))}
        <div title={t("summary.monthlyHint")}>
          <dt className="text-[11.5px] text-subtle">{t("summary.monthly")}</dt>
          <dd className={`${NUM} mt-0.5 text-[22px] font-semibold leading-tight text-foreground`}>
            {totals.length ? totals.map((x) => money(x.amount, x.currency)).join(" + ") : t("summary.none")}
          </dd>
        </div>
      </dl>

      <Watchdog watch={watchRow} beatAt={beatAt} />

      {all.length === 0 ? (
        <div className="mt-6">
          <EmptyState Icon={CreditCard} tone="idle" title={t("list.empty")} hint={t("list.emptyHint")} />
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-border overflow-hidden rounded-2xl bg-surface ring-1 ring-border">
          {all.map((s) => (
            <li key={s.id}>
              <Link
                href={`${BASE}?s=${s.id}` as typeof BASE}
                prefetch={false}
                aria-current={s.id === openId ? "true" : undefined}
                className="flex items-start gap-4 px-4 py-3.5 transition hover:bg-[var(--row-hover)]"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span dir="auto" className="text-[13.5px] font-semibold text-foreground">
                      {s.name}
                    </span>
                    <StatusPill tone={TONE[s.state]}>{stateText(s)}</StatusPill>
                    {s.auto_source && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-subtle" title={s.auto_checked_at ? ago(s.auto_checked_at) : undefined}>
                        <RadioTower className="size-3" strokeWidth={2.2} />
                        {t("list.auto")}
                      </span>
                    )}
                  </span>
                  <span dir="auto" className="mt-0.5 block truncate text-[11.5px] text-subtle">
                    {s.provider} · {t(`kinds.${s.kind}`)}
                    {s.purpose ? ` · ${s.purpose}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-end">
                  <span className={`${NUM} block text-[12.5px] text-foreground/90`}>
                    {s.renews_on ? t("list.renews", { date: dayText(s.renews_on) }) : t("list.noDate")}
                  </span>
                  <span className={`${NUM} mt-0.5 block text-[11px] text-subtle`}>{priceText(s)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <section id="alertes" className="mt-10 scroll-mt-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-semibold tracking-tight text-foreground">{t("alerts.title")}</h2>
            <p className="mt-1 max-w-2xl text-[12.5px] text-muted">{t("alerts.hint")}</p>
          </div>
          <TestSmsButton disabled={!isSmsConfigured() || valid.length === 0} />
        </div>
        <p className="mt-3 text-[12px] text-subtle">
          {t("alerts.to", { list: valid.length ? valid.join(" · ") : t("summary.none") })}
          {invalid.length > 0 && (
            <span className="ms-2 font-semibold text-[var(--tone-bad)]">{t("alerts.invalid", { list: invalid.join(", ") })}</span>
          )}
        </p>
        <div className="mt-4">
          <SettingsPanel
            keys={SETTING_KEYS}
            values={Object.fromEntries(SETTING_KEYS.map((k) => [k, settings[k]]))}
            stored={rows.map((r) => r.key)}
          />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-[16px] font-semibold tracking-tight text-foreground">{t("log.title")}</h2>
        {log.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-subtle">{t("log.empty")}</p>
        ) : (
          <AlertTable alerts={log.slice(0, 20)} showService />
        )}
      </section>

      {(creating || selected) && (
        <SidePanel
          param="s"
          title={selected ? selected.name : t("editor.new")}
          subtitle={selected ? `${selected.provider} · ${stateText(selected)}` : undefined}
          footer={
            selected ? (
              <ServiceActions
                id={selected.id}
                active={selected.active}
                canRenew={Boolean(selected.renews_on) && (selected.cycle === "monthly" || selected.cycle === "yearly") && selected.auto_source !== "vercel" && selected.auto_source !== "rdap" && selected.auto_source !== "winsms"}
                afterDeleteHref={`/${locale}${BASE}`}
              />
            ) : undefined
          }
        >
          {selected && <ProviderSays s={selected} />}
          {selected && (
            <section className="mb-6">
              <h3 className={EYEBROW}>{t("detail.alerts")}</h3>
              {log.some((a) => a.service_id === selected.id) ? (
                <AlertTable alerts={log.filter((a) => a.service_id === selected.id)} />
              ) : (
                <p className="mt-1.5 text-[12px] text-subtle">{t("detail.noAlerts")}</p>
              )}
            </section>
          )}
          <ServiceEditor
            key={selected?.id ?? "new"}
            service={selected ? toEditable(selected) : null}
            defaultLead={lead}
            accounts={accounts}
            closeHref={`/${locale}${BASE}`}
          />
        </SidePanel>
      )}
    </div>
  );

  /** The watchdog's line: what the database saw of the site, and the hourly run. */
  function Watchdog({ watch, beatAt }: { watch: Watch | null; beatAt: string | null }) {
    let line: string;
    let tone: Tone = "ok";
    if (!watch?.last_checked_at) {
      line = t("watchdog.waiting");
      tone = "neutral";
    } else if (watch.incident === "site_blocked") {
      line = t("watchdog.blocked", { since: ago(watch.incident_since ?? watch.last_checked_at) });
      tone = "bad";
    } else if (watch.incident === "site_down") {
      line = t("watchdog.down", { since: ago(watch.incident_since ?? watch.last_checked_at) });
      tone = "bad";
    } else if (watch.incident === "monitor_stale") {
      line = t("watchdog.stale", { since: ago(beatAt ?? watch.last_checked_at) });
      tone = "warn";
    } else {
      line = t("watchdog.ok", { code: watch.last_code ?? 0, ago: ago(watch.last_checked_at) });
    }
    return (
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-subtle">
        <span className="inline-flex items-center gap-1.5">
          <StatusPill tone={tone}>{t("watchdog.title")}</StatusPill>
          <span>{line}</span>
        </span>
        <span>{beatAt ? t("watchdog.hourly", { ago: ago(beatAt) }) : t("watchdog.hourlyNever")}</span>
      </div>
    );
  }

  /** What the provider itself said at the last check. */
  function ProviderSays({ s }: { s: PaidService }) {
    const d = s.auto_detail ?? {};
    const str = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : null);
    const lines: string[] = [];
    if (s.auto_source === "vercel") {
      const end = str("periodEnd");
      lines.push(t("detail.vercel", { plan: str("plan") ?? "?", status: str("status") ?? "?", date: end ? formatDate(end, locale, "medium") : "?" }));
      if (str("block")) lines.push(t("detail.vercelBlock", { reason: str("block") ?? "", since: str("blockedAt") ? ago(str("blockedAt") as string) : "?" }));
    } else if (s.auto_source === "rdap") {
      const exp = str("expiresAt");
      lines.push(t("detail.rdap", { registrar: str("registrar") ?? "?", date: exp ? formatDate(exp, locale, "medium") : "?" }));
      if (Array.isArray(d.statuses) && d.statuses.length) lines.push(t("detail.rdapStatus", { statuses: (d.statuses as string[]).join(", ") }));
    } else if (s.auto_source === "winsms") {
      lines.push(t("detail.winsms", { balance: formatNumber(Number(d.balance ?? 0), locale), date: str("licence") ? dayText(str("licence") as string) : "?" }));
      if (str("holder")) lines.push(t("detail.winsmsHolder", { holder: str("holder") ?? "" }));
    } else if (s.auto_source === "anthropic") {
      lines.push(t("detail.anthropic", { calls: formatNumber(Number(d.calls30 ?? 0), locale), spend: formatNumber(Number(d.spend30 ?? 0), locale, { maxDecimals: 2 }) }));
      if (str("noCreditSince")) lines.push(t("detail.anthropicNoCredit", { since: ago(str("noCreditSince") as string) }));
    } else if (s.auto_source === "supabase") {
      lines.push(t("detail.supabase"));
    }
    if (s.auto_status === "error" && str("error")) lines.push(t("detail.error", { error: str("error") ?? "" }));

    return (
      <section className="mb-6 space-y-3">
        {s.auto_source && (
          <div className="rounded-xl bg-surface-2 px-3.5 py-3 ring-1 ring-border">
            <p className="flex items-center justify-between gap-2 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-subtle">
              <span>{t("detail.providerSays", { provider: s.provider })}</span>
              <span className="font-normal normal-case tracking-normal">
                {s.auto_checked_at ? t("detail.checked", { ago: ago(s.auto_checked_at) }) : ""}
              </span>
            </p>
            {s.auto_checked_at ? (
              lines.map((l) => (
                <p key={l} dir="auto" className="mt-1.5 text-[12.5px] text-foreground">
                  {l}
                </p>
              ))
            ) : (
              <p className="mt-1.5 text-[12.5px] text-muted">{t("detail.notChecked")}</p>
            )}
          </div>
        )}
        {s.billing_url && (
          <a
            href={s.billing_url}
            target="_blank"
            rel="noopener noreferrer"
            className={`${adminBtn("default", "sm")} gap-1.5`}
          >
            <ExternalLink className="size-3.5" strokeWidth={2.4} />
            {t("detail.billing")}
          </a>
        )}
      </section>
    );
  }

  /** SMS sent or tried, newest first. */
  function AlertTable({ alerts, showService = false }: { alerts: Alert[]; showService?: boolean }) {
    const tone: Record<Alert["status"], Tone> = { sent: "ok", failed: "bad", sending: "info" };
    return (
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[520px] text-[12.5px]">
          <thead>
            <tr className={`${EYEBROW} border-b border-border`}>
              <th scope="col" className="py-1.5 text-start font-bold">{t("log.when")}</th>
              {showService && <th scope="col" className="py-1.5 text-start font-bold">{t("log.service")}</th>}
              <th scope="col" className="py-1.5 text-start font-bold">{t("log.stage")}</th>
              <th scope="col" className="py-1.5 text-start font-bold">{t("log.phone")}</th>
              <th scope="col" className="py-1.5 text-end font-bold">{t("log.status")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {alerts.map((a) => (
              <tr key={a.id}>
                <td className={`${NUM} py-1.5 text-subtle`}>{formatDate(a.sent_at ?? a.created_at, locale, "dateTime")}</td>
                {showService && (
                  <td dir="auto" className="py-1.5">
                    {a.service_id ? nameOf.get(a.service_id) ?? "—" : t("log.site")}
                  </td>
                )}
                <td className="py-1.5">{t(`stages.${a.stage}` as "stages.lead")}</td>
                <td dir="ltr" className={`${NUM} py-1.5 text-start`}>+{a.phone}</td>
                <td className="py-1.5 text-end">
                  <StatusPill tone={tone[a.status]}>
                    {a.error === "daily_cap" ? t("log.dailyCap") : t(`alertStatus.${a.status}`)}
                  </StatusPill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
}

function toEditable(s: PaidService): EditableService {
  return {
    id: s.id,
    kind: s.kind,
    provider: s.provider,
    name: s.name,
    purpose: s.purpose,
    cost: s.cost,
    currency: s.currency,
    cycle: s.cycle,
    renewsOn: s.renews_on,
    autoRenew: s.auto_renew,
    account: s.account,
    paymentNote: s.payment_note,
    billingUrl: s.billing_url,
    leadDays: s.lead_days,
    active: s.active,
    notes: s.notes,
    autoDate: s.auto_source === "vercel" || s.auto_source === "rdap" || s.auto_source === "winsms",
  };
}
