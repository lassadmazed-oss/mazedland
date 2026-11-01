/**
 * The paid services the site lives on (0203, /admin/abonnements): what a row
 * means, where it stands today, and which SMS is due. Pure — the hourly run,
 * the console and the tests share it.
 *
 * A row's date is a Tunis day (YYYY-MM-DD): the next renewal of a
 * subscription, the expiry of a domain, the end of a licence. What the
 * provider reports (src/lib/services/providers.ts) lands in `auto_status`:
 * Vercel's block, an unpaid invoice, a credit running low.
 */
import { addMonths } from "@/lib/ads/dates";
import { anyPhoneToE164 } from "@/lib/tunisia";
import { phoneToWinSMS } from "@/lib/winsms";

export const SERVICE_KINDS = ["hosting", "database", "domain", "sms", "email", "ai", "other"] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

export const SERVICE_CYCLES = ["monthly", "yearly", "prepaid", "usage", "once"] as const;
export type ServiceCycle = (typeof SERVICE_CYCLES)[number];

export const SERVICE_CURRENCIES = ["USD", "EUR", "TND"] as const;
export type ServiceCurrency = (typeof SERVICE_CURRENCIES)[number];

export const AUTO_SOURCES = ["vercel", "supabase", "rdap", "winsms", "anthropic"] as const;
export type AutoSource = (typeof AUTO_SOURCES)[number];

export const AUTO_STATUSES = ["ok", "unpaid", "blocked", "low", "error"] as const;
export type AutoStatus = (typeof AUTO_STATUSES)[number];

/** The lead times the console offers (services_lead_days has the same). */
export const LEAD_CHOICES = [1, 3, 4, 7, 14] as const;

/** How a service is usually paid, offered as chips under « Paiement ». */
export const PAYMENT_NOTES = ["card", "transfer", "d17", "prepaid", "cash"] as const;
export type PaymentNote = (typeof PAYMENT_NOTES)[number];

export type PaidService = {
  id: string;
  seed_key: string | null;
  kind: ServiceKind;
  provider: string;
  name: string;
  purpose: string | null;
  cost: number | null;
  currency: ServiceCurrency;
  cycle: ServiceCycle;
  renews_on: string | null;
  auto_renew: boolean;
  account: string | null;
  payment_note: string | null;
  billing_url: string | null;
  lead_days: number | null;
  active: boolean;
  notes: string | null;
  auto_source: AutoSource | null;
  auto_ref: string | null;
  auto_status: AutoStatus | null;
  auto_detail: Record<string, unknown>;
  auto_checked_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

/**
 * Ready-made providers: picking one fills the form, so a new row is a tap and
 * a date. `name` empty = the admin names it (a domain is its own name).
 */
export const PROVIDER_PRESETS = [
  { key: "vercel", provider: "Vercel", kind: "hosting", name: "Vercel Pro", cycle: "monthly", currency: "USD", autoRenew: true, billingUrl: "https://vercel.com/lassad/~/settings/billing" },
  { key: "supabase", provider: "Supabase", kind: "database", name: "Supabase Pro", cycle: "monthly", currency: "USD", autoRenew: true, billingUrl: "https://supabase.com/dashboard/org/_/billing" },
  { key: "hostinger", provider: "Hostinger", kind: "domain", name: "", cycle: "yearly", currency: "USD", autoRenew: true, billingUrl: "https://hpanel.hostinger.com/domains" },
  { key: "winsms", provider: "WinSMS", kind: "sms", name: "WinSMS", cycle: "prepaid", currency: "TND", autoRenew: false, billingUrl: "https://www.winsmspro.com/sms/" },
  { key: "anthropic", provider: "Anthropic", kind: "ai", name: "Claude (API)", cycle: "prepaid", currency: "USD", autoRenew: false, billingUrl: "https://platform.claude.com/settings/billing" },
  { key: "resend", provider: "Resend", kind: "email", name: "Resend", cycle: "monthly", currency: "USD", autoRenew: true, billingUrl: "https://resend.com/settings/billing" },
  { key: "google", provider: "Google Workspace", kind: "email", name: "Google Workspace", cycle: "monthly", currency: "USD", autoRenew: true, billingUrl: "https://admin.google.com/ac/billing" },
  { key: "meta", provider: "Meta", kind: "other", name: "Publicité Facebook", cycle: "usage", currency: "USD", autoRenew: true, billingUrl: "https://business.facebook.com/billing_hub" },
] as const satisfies readonly {
  key: string;
  provider: string;
  kind: ServiceKind;
  name: string;
  cycle: ServiceCycle;
  currency: ServiceCurrency;
  autoRenew: boolean;
  billingUrl: string;
}[];

/** Where a service stands, worst first. */
export const SERVICE_STATES = ["blocked", "unpaid", "overdue", "today", "soon", "low", "unknown", "error", "ok", "paused"] as const;
export type ServiceState = (typeof SERVICE_STATES)[number];

/** Whole days from `from` to `to` (both YYYY-MM-DD); negative once `to` is past. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

type Judged = Pick<PaidService, "active" | "renews_on" | "lead_days" | "auto_status" | "cycle">;

export function leadOf(s: Pick<PaidService, "lead_days">, defaultLead: number): number {
  return s.lead_days ?? defaultLead;
}

/**
 * The service's state on `today`, and the days left to its date (null without
 * one). What the provider says comes first — a block is a block whatever the
 * date — then the date, then a low credit. A prepaid credit or a usage bill
 * has no date to miss, so none is « à compléter ».
 */
export function serviceState(s: Judged, today: string, defaultLead: number): { state: ServiceState; days: number | null } {
  const days = s.renews_on ? daysBetween(today, s.renews_on) : null;
  if (!s.active) return { state: "paused", days };
  if (s.auto_status === "blocked") return { state: "blocked", days };
  if (s.auto_status === "unpaid") return { state: "unpaid", days };
  if (days !== null) {
    if (days < 0) return { state: "overdue", days };
    if (days === 0) return { state: "today", days };
    if (days <= leadOf(s, defaultLead)) return { state: "soon", days };
  }
  if (s.auto_status === "low") return { state: "low", days };
  if (days === null && s.cycle !== "prepaid" && s.cycle !== "usage") return { state: "unknown", days };
  if (s.auto_status === "error") return { state: "error", days };
  return { state: "ok", days };
}

export type AlertStage = "lead" | "day_before" | "day" | "overdue" | "unpaid" | "blocked" | "low";

/** Stages that last as long as the provider says so (cycle « open »). */
export const CONDITION_STAGES = ["unpaid", "blocked", "low"] as const satisfies readonly AlertStage[];

/** Sent at once, quiet hours or not (services_urgent_at_night), and past the daily cap. */
export const URGENT_STAGES: ReadonlySet<AlertStage> = new Set(["unpaid", "blocked"]);

/** A date passed longer ago than this is shown in red, not texted about. */
export const OVERDUE_SMS_DAYS = 7;

export type DueAlert = { stage: AlertStage; cycle: string; days: number | null };

/**
 * The SMS this service is due today, at most one per stage and cycle (the
 * alert log in 0203 remembers which went). The reminders follow the date:
 * `lead` days before (four by default), the day before, the day itself, and
 * once after it passed. Only the stage of today is due — a service added two
 * days before its end gets « demain » and « aujourd'hui », not a late
 * « dans 4 jours ». A block or an unpaid invoice replaces the reminders: it
 * is the message that matters.
 */
export function dueAlerts(
  s: Judged,
  today: string,
  opts: { defaultLead: number; dayBefore: boolean; onDay: boolean },
): DueAlert[] {
  if (!s.active) return [];
  if (s.auto_status === "blocked") return [{ stage: "blocked", cycle: "open", days: null }];
  if (s.auto_status === "unpaid") return [{ stage: "unpaid", cycle: "open", days: null }];

  const out: DueAlert[] = [];
  if (s.renews_on) {
    const days = daysBetween(today, s.renews_on);
    const lead = leadOf(s, opts.defaultLead);
    const at = (stage: AlertStage) => out.push({ stage, cycle: s.renews_on as string, days });
    if (days < 0 && days >= -OVERDUE_SMS_DAYS) at("overdue");
    else if (days === 0 && opts.onDay) at("day");
    else if (days === 1) {
      if (opts.dayBefore) at("day_before");
      else if (lead >= 1) at("lead");
    } else if (days >= 2 && days <= lead) at("lead");
  }
  if (s.auto_status === "low") out.push({ stage: "low", cycle: "open", days: null });
  return out;
}

/** Whether `hour` (0–23, Tunis) falls in the quiet hours from `start` to `end`. */
export function inQuietHours(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start > end ? hour >= start || hour < end : hour >= start && hour < end;
}

/** The hour in Tunis (UTC+1 all year), 0–23. */
export function tunisHour(now: Date = new Date()): number {
  return (now.getUTCHours() + 1) % 24;
}

/** The next date once this cycle is paid: a month or a year on. Null for the others. */
export function nextRenewal(day: string, cycle: ServiceCycle): string | null {
  if (cycle === "monthly") return addMonths(day, 1);
  if (cycle === "yearly") return addMonths(day, 12);
  return null;
}

/**
 * What a service costs a month, for the page's total: a yearly fee spread
 * over twelve. Prepaid credit, usage and one-off payments have no monthly
 * figure and are left out (null).
 */
export function monthlyCost(s: Pick<PaidService, "cost" | "cycle" | "active">): number | null {
  if (!s.active || s.cost === null) return null;
  if (s.cycle === "monthly") return s.cost;
  if (s.cycle === "yearly") return Math.round((s.cost / 12) * 100) / 100;
  return null;
}

/** One total per currency, the currencies in a fixed order. */
export function monthlyTotals(rows: Pick<PaidService, "cost" | "cycle" | "active" | "currency">[]): { currency: ServiceCurrency; amount: number }[] {
  const sums = new Map<ServiceCurrency, number>();
  for (const r of rows) {
    const m = monthlyCost(r);
    if (m !== null) sums.set(r.currency, (sums.get(r.currency) ?? 0) + m);
  }
  return SERVICE_CURRENCIES.filter((c) => sums.has(c)).map((c) => ({
    currency: c,
    amount: Math.round((sums.get(c) as number) * 100) / 100,
  }));
}

/** The alert recipients as WinSMS digits (21698124111), each once; what is not a number is dropped. */
export function recipientDigits(list: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of list) {
    const e164 = anyPhoneToE164(raw);
    if (e164) out.add(phoneToWinSMS(e164));
  }
  return [...out];
}
