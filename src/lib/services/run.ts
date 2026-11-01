/**
 * One pass of the paid-services watch: ask each provider, store what it said,
 * send the SMS that are due. Run hourly by Vercel (/api/cron/services), and
 * by « Vérifier maintenant » in /admin/abonnements.
 *
 * Every SMS goes through claim_service_alert (0203) first: one row per
 * service, stage, cycle and number, so two runs at once — the cron and a
 * click — send it once. The site's own SMS rules hold: WinSMS through
 * sendSms, `sms_daily_cap` per number (0 = no SMS at all), the quiet hours of
 * /admin/abonnements, which only a block or an unpaid invoice may cross.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTranslations } from "next-intl/server";
import { loadSettings } from "@/lib/settings/server";
import { SETTINGS, type Settings } from "@/lib/settings/registry";
import { isSmsConfigured, sendSms, toSmsText } from "@/lib/winsms";
import { tunisDay } from "@/lib/visits";
import { intlTag } from "@/lib/utils";
import { PRODUCTION_ORIGIN, siteUrl } from "@/lib/siteUrl";
import { log } from "@/lib/log";
import type { AppLocale } from "@/lib/i18n";
import { readProvider, type Reading } from "./providers";
import {
  CONDITION_STAGES, URGENT_STAGES, dueAlerts, inQuietHours, recipientDigits, tunisHour,
  type AlertStage, type PaidService,
} from "./services";

const sLog = log.scope("services");

// The SMS's first line: the sender ID is MAZED for both apps.
const BRAND = "Mazed Immo";
const HEARTBEAT = "services_watch";
// Hourly, so three hours without a stamp is two runs missed (the watchdog in
// 0203 texts the owner when it sees that).
const HEARTBEAT_MAX_AGE = 3 * 3600;

export type WatchReport = {
  services: number;
  refreshed: number;
  providerErrors: number;
  sent: number;
  failed: number;
  /** Due, but held back by the quiet hours: they go with the next run after. */
  waiting: number;
};

function dayText(day: string, lang: AppLocale): string {
  return new Intl.DateTimeFormat(intlTag(lang), { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${day}T12:00:00Z`),
  );
}

function consoleUrl(lang: AppLocale): string {
  return `${siteUrl() ?? PRODUCTION_ORIGIN}/${lang}/admin/abonnements`;
}

/** The SMS for one service and stage, in the language the console chose. */
export async function alertText(
  s: Pick<PaidService, "name" | "provider" | "renews_on" | "auto_renew" | "billing_url" | "auto_detail">,
  stage: AlertStage,
  days: number | null,
  lang: AppLocale,
): Promise<{ text: string; unicode: boolean }> {
  const t = await getTranslations({ locale: lang, namespace: "adminServices.sms" });
  const vars = {
    name: s.name,
    provider: s.provider,
    date: s.renews_on ? dayText(s.renews_on, lang) : "",
    days: Math.abs(days ?? 0),
    balance: String(s.auto_detail?.balance ?? ""),
    status: String(s.auto_detail?.block ?? s.auto_detail?.status ?? ""),
  };
  const dated = stage === "lead" || stage === "day_before" || stage === "day";
  const body = `${t(`body.${stage}`, vars)}${dated ? ` ${t(s.auto_renew ? "action.auto" : "action.manual")}` : ""}`;
  return toSmsText({ brand: BRAND, title: t(`title.${stage}`, vars), body, url: s.billing_url ?? consoleUrl(lang) });
}

type Db = SupabaseClient;

/** Sends one claimed alert and records how it went. */
async function deliver(
  db: Db,
  id: number,
  phone: string,
  sms: { text: string; unicode: boolean },
): Promise<boolean> {
  const result = await sendSms({ to: phone, sms: sms.text, unicode: sms.unicode });
  await db
    .from("paid_service_alerts")
    .update(
      result.ok
        ? { status: "sent", sent_at: new Date().toISOString(), message: sms.text, error: null }
        : { status: "failed", message: sms.text, error: result.error.slice(0, 200) },
    )
    .eq("id", id);
  return result.ok;
}

async function claim(db: Db, serviceId: string | null, stage: string, cycle: string, phone: string): Promise<number | null> {
  const { data, error } = await db.rpc("claim_service_alert", {
    p_service: serviceId,
    p_stage: stage,
    p_cycle: cycle,
    p_phone: phone,
  });
  if (error) {
    sLog.error("claim failed", { stage, msg: error.message });
    return null;
  }
  return typeof data === "number" ? data : null;
}

/** What a provider reading changes on the row (the stored date stays when it has none). */
function readingPatch(s: PaidService, r: Reading, at: string): Partial<PaidService> {
  return {
    auto_status: r.status,
    auto_detail: r.detail,
    auto_checked_at: at,
    ...(r.renewsOn ? { renews_on: r.renewsOn } : {}),
    ...(r.costUsd !== undefined && s.currency === "USD" ? { cost: r.costUsd } : {}),
  };
}

export async function runServicesWatch(db: Db, { send }: { send: boolean }): Promise<WatchReport> {
  const settings = await loadSettings(db);
  const { data, error } = await db.from("paid_services").select("*").order("sort_order").order("created_at");
  if (error) throw new Error(`paid_services: ${error.message}`);
  const report: WatchReport = { services: 0, refreshed: 0, providerErrors: 0, sent: 0, failed: 0, waiting: 0 };

  // 1. The providers, all at once: none waits for another's timeout.
  const at = new Date().toISOString();
  const services = await Promise.all(
    ((data ?? []) as PaidService[]).map(async (s) => {
      if (!s.active || !s.auto_source) return s;
      let patch: Partial<PaidService>;
      try {
        patch = readingPatch(s, await readProvider(s, { db, lowBalance: settings.services_sms_low_balance }), at);
        report.refreshed += 1;
      } catch (e) {
        report.providerErrors += 1;
        // A provider that does not answer keeps what it said last, plus why.
        patch = {
          auto_status: "error",
          auto_detail: { ...s.auto_detail, error: String((e as Error)?.message ?? e).slice(0, 200) },
          auto_checked_at: at,
        };
      }
      const { error: upErr } = await db.from("paid_services").update(patch).eq("id", s.id);
      if (upErr) sLog.error("service update failed", { id: s.id, msg: upErr.message });
      return { ...s, ...patch } as PaidService;
    }),
  );
  report.services = services.length;

  if (send) await sendDue(db, services, settings, report);

  await db.rpc("stamp_cron_heartbeat", { p_job: HEARTBEAT, p_max_age: HEARTBEAT_MAX_AGE }).then(() => {}, () => {});
  return report;
}

async function sendDue(db: Db, services: PaidService[], settings: Settings, report: WatchReport) {
  const today = tunisDay();
  const due = services.map((s) => ({
    s,
    alerts: dueAlerts(s, today, {
      defaultLead: settings.services_lead_days,
      dayBefore: settings.services_alert_day_before,
      onDay: settings.services_alert_on_day,
    }),
  }));

  // A condition that cleared (paid, topped up) re-arms: its « open » rows are
  // renamed, so the next block is texted again.
  const { data: open } = await db
    .from("paid_service_alerts")
    .select("id, service_id, stage")
    .eq("cycle_key", "open")
    .in("stage", [...CONDITION_STAGES]);
  for (const row of (open ?? []) as { id: number; service_id: string | null; stage: AlertStage }[]) {
    const still = due.find((d) => d.s.id === row.service_id)?.alerts.some((a) => a.stage === row.stage);
    if (!still) await db.from("paid_service_alerts").update({ cycle_key: `closed:${row.id}` }).eq("id", row.id);
  }

  if (!settings.services_alerts_enabled || settings.sms_daily_cap === 0 || !isSmsConfigured()) return;
  const phones = recipientDigits(settings.services_sms_recipients);
  if (phones.length === 0) return;
  const quiet = inQuietHours(tunisHour(), settings.services_quiet_start, settings.services_quiet_end);
  const lang: AppLocale = settings.services_sms_arabic ? "ar" : "fr";

  for (const { s, alerts } of due) {
    for (const alert of alerts) {
      const urgent = URGENT_STAGES.has(alert.stage);
      if (quiet && !(urgent && settings.services_urgent_at_night)) {
        report.waiting += 1;
        continue;
      }
      const sms = await alertText(s, alert.stage, alert.days, lang);
      for (const phone of phones) {
        const id = await claim(db, s.id, alert.stage, alert.cycle, phone);
        if (id === null) continue;
        // Reminders count against the number's daily cap; a block never waits for it.
        if (!urgent) {
          const { data: capped } = await db.rpc("check_rate_limit", {
            p_key: `sms:services:${phone}`,
            p_max: settings.sms_daily_cap,
            p_window_secs: 86400,
          });
          if (capped === true) {
            await db.from("paid_service_alerts").update({ status: "failed", error: "daily_cap" }).eq("id", id);
            report.failed += 1;
            continue;
          }
        }
        if (await deliver(db, id, phone, sms)) report.sent += 1;
        else report.failed += 1;
      }
    }
  }
}

/**
 * « Envoyer un SMS de test »: one SMS to each recipient now, quiet hours or
 * not — the admin is looking at the page. Logged like the others.
 */
export async function sendTestSms(db: Db): Promise<{ sent: number; failed: number; phones: number }> {
  const settings = await loadSettings(db);
  const phones = recipientDigits(settings.services_sms_recipients);
  const lang: AppLocale = settings.services_sms_arabic ? "ar" : "fr";
  const t = await getTranslations({ locale: lang, namespace: "adminServices.sms" });
  const sms = toSmsText({ brand: BRAND, title: t("title.test"), body: t("body.test"), url: consoleUrl(lang) });
  const cycle = new Date().toISOString();
  let sent = 0;
  let failed = 0;
  for (const phone of phones) {
    const id = await claim(db, null, "test", cycle, phone);
    if (id === null) continue;
    if (await deliver(db, id, phone, sms)) sent += 1;
    else failed += 1;
  }
  return { sent, failed, phones: phones.length };
}

/**
 * The database does not answer at all, so nothing can be read or logged:
 * the registry's own defaults say who to tell. Sent on the run of every
 * sixth hour only (00:07, 06:07… UTC) — with no log to remember the last
 * one, that is what keeps it to four a day.
 */
export async function sendDatabaseDownSms(now: Date = new Date()): Promise<number> {
  if (!isSmsConfigured() || now.getUTCHours() % 6 !== 0) return 0;
  const lang: AppLocale = SETTINGS.services_sms_arabic.default ? "ar" : "fr";
  const t = await getTranslations({ locale: lang, namespace: "adminServices.sms" });
  const sms = toSmsText({ brand: BRAND, title: t("title.database_down"), body: t("body.database_down"), url: "https://supabase.com/dashboard" });
  let sent = 0;
  for (const phone of recipientDigits(SETTINGS.services_sms_recipients.default)) {
    const r = await sendSms({ to: phone, sms: sms.text, unicode: sms.unicode });
    if (r.ok) sent += 1;
  }
  return sent;
}
