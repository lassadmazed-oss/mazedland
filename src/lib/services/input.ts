/**
 * What the console may write into `paid_services`, checked field by field —
 * the table's CHECKs (0203) catch the rest, but as a redacted 500; this names
 * the field. `partial` is the PATCH: only the fields sent are read, so
 * « Suivi arrêté » can send `{ active: false }` alone.
 *
 * The auto_* columns are the providers' and never come from here.
 */
import { isoDay } from "@/lib/listings/deal";
import {
  SERVICE_CURRENCIES, SERVICE_CYCLES, SERVICE_KINDS,
  type PaidService, type ServiceCurrency, type ServiceCycle, type ServiceKind,
} from "./services";

export type ServiceWrite = Partial<
  Pick<
    PaidService,
    | "kind" | "provider" | "name" | "purpose" | "cost" | "currency" | "cycle" | "renews_on" | "auto_renew"
    | "account" | "payment_note" | "billing_url" | "lead_days" | "active" | "notes"
  >
>;

/** The field that is wrong — each has a sentence in `adminServices.api`. */
export type ServiceInputError =
  | "kind" | "provider" | "name" | "purpose" | "cost" | "currency" | "cycle" | "renews_on" | "auto_renew"
  | "account" | "payment_note" | "billing_url" | "lead_days" | "active" | "notes";

export type ServiceInputResult = { ok: true; value: ServiceWrite } | { ok: false; error: ServiceInputError };

/** Trimmed text, `null` for empty, `undefined` for too long or not text. */
function text(v: unknown, max: number): string | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s) return null;
  return s.length <= max ? s : undefined;
}

function oneOf<T extends string>(list: readonly T[], v: unknown): T | undefined {
  return typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : undefined;
}

/** « vercel.com/… » as typed becomes https://vercel.com/…; anything else that is not https is refused. */
export function billingLink(v: unknown): string | null | undefined {
  const s = text(v, 300);
  if (s === null || s === undefined) return s;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "https:" || !u.hostname.includes(".")) return undefined;
    return u.toString();
  } catch {
    return undefined;
  }
}

export function parseServiceInput(body: Record<string, unknown>, { partial }: { partial: boolean }): ServiceInputResult {
  const out: ServiceWrite = {};
  const has = (k: string) => !partial || k in body;

  if (has("kind")) {
    const v = oneOf<ServiceKind>(SERVICE_KINDS, body.kind ?? "other");
    if (!v) return { ok: false, error: "kind" };
    out.kind = v;
  }
  for (const [key, max] of [["provider", 60], ["name", 120]] as const) {
    if (!has(key)) continue;
    const v = text(body[key], max);
    if (!v) return { ok: false, error: key };
    out[key] = v;
  }
  for (const [key, max] of [["purpose", 300], ["account", 160], ["payment_note", 200], ["notes", 1000]] as const) {
    if (!has(key)) continue;
    const v = text(body[key], max);
    if (v === undefined) return { ok: false, error: key };
    out[key] = v;
  }
  if (has("cost")) {
    const raw = body.cost;
    if (raw === null || raw === undefined || raw === "") out.cost = null;
    else {
      const n = Number(typeof raw === "string" ? raw.trim().replace(",", ".") : raw);
      if (typeof raw === "boolean" || !Number.isFinite(n) || n < 0 || n > 1_000_000) return { ok: false, error: "cost" };
      out.cost = Math.round(n * 100) / 100;
    }
  }
  if (has("currency")) {
    const v = oneOf<ServiceCurrency>(SERVICE_CURRENCIES, body.currency ?? "USD");
    if (!v) return { ok: false, error: "currency" };
    out.currency = v;
  }
  if (has("cycle")) {
    const v = oneOf<ServiceCycle>(SERVICE_CYCLES, body.cycle ?? "monthly");
    if (!v) return { ok: false, error: "cycle" };
    out.cycle = v;
  }
  if (has("renews_on")) {
    const raw = body.renews_on;
    if (raw === null || raw === undefined || raw === "") out.renews_on = null;
    else {
      const day = typeof raw === "string" ? isoDay(raw) : null;
      if (!day) return { ok: false, error: "renews_on" };
      out.renews_on = day;
    }
  }
  for (const key of ["auto_renew", "active"] as const) {
    if (!has(key)) continue;
    const raw = body[key] ?? true;
    if (typeof raw !== "boolean") return { ok: false, error: key };
    out[key] = raw;
  }
  if (has("billing_url")) {
    const v = billingLink(body.billing_url);
    if (v === undefined) return { ok: false, error: "billing_url" };
    out.billing_url = v;
  }
  if (has("lead_days")) {
    const raw = body.lead_days;
    if (raw === null || raw === undefined || raw === "") out.lead_days = null;
    else {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 60) return { ok: false, error: "lead_days" };
      out.lead_days = n;
    }
  }
  return { ok: true, value: out };
}
