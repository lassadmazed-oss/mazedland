/**
 * The site's own analytics events, beside Google's (src/lib/analytics/ga.ts).
 *
 * `trackEvent(name, params, ids)` is what a component calls when something
 * happened: it hands the event to Google (which only takes it once loaded,
 * so consent is respected by construction) and queues it for the site's own
 * count, sent in small batches to /api/events and kept in `site_events`
 * (0204). Google is sampled, consent-gated and a day late; the site's count
 * is exact, per annonce and per agence, and feeds /admin/analytics.
 *
 * Rules, the same as Google's: nothing on the console, nothing that names a
 * person — an annonce's id, a search's words (with a phone number or an
 * e-mail taken out), a step, a button. The batch carries no identifier: the
 * server counts a visitor by a key that changes every day, unless the
 * visitor accepted analytics, in which case a random id this browser made
 * (`mazed-cid`) lets a return visit count as the same visitor.
 *
 * The pure parts (the names, the cleaning, the batch's shape, the decision to
 * send) are tested; the transport is a thin layer over sendBeacon.
 */
import { cleanSearchTerm, isConsolePath, maskPersonal, track, type EventParams } from "./ga";

/** Every event the site sends, documented in one place (docs/analytics.md). */
export const EVENT_NAMES = [
  "page_view",
  "search",
  "catalogue_view",
  "listing_impression",
  "listing_view",
  "gallery_open",
  "gallery_photo",
  "phone_reveal",
  "contact_call",
  "contact_whatsapp",
  "contact_email",
  "contact_site",
  "visit_request_open",
  "visit_request",
  "favourite_add",
  "favourite_remove",
  "compare_add",
  "compare_remove",
  "compare_open",
  "share",
  "credit_simulator_open",
  "credit_simulator_use",
  "agence_view",
  "agence_contact",
  "pro_cta",
  "plan_choose",
  "payment_start",
  "payment_submit",
  "payment_cancel",
  "publish_start",
  "publish_step",
  "publish_photos",
  "publish_listing",
  "publish_abandon",
  "voice_publish_start",
  "voice_publish_finish",
  "upload_failed",
  "demande_create",
  "agence_request",
  "listing_import",
  "sign_up",
  "login",
  "logout",
  "install_shown",
  "install_click",
  "install_done",
  "consent",
  "language_switch",
  "not_found",
  "client_error",
  "whatsapp_help",
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export const EVENT_NAME_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;

export type Ids = { listing?: string | null; shop?: string | null };

/** One event as the batch carries it. */
export type QueuedEvent = {
  n: string;
  p: Record<string, string | number | boolean | string[]>;
  /** Milliseconds before the batch was sent (0 = at send time), so the server keeps the order. */
  t: number;
  path: string;
  listing?: string;
  shop?: string;
};

export const MAX_BATCH = 25;
export const MAX_PARAM_BYTES = 2000;
const MAX_QUEUE = 60;
const FLUSH_MS = 2500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

/** The path a page is counted under: no query string, no fragment, 200 characters at most. */
export function cleanPath(href: string): string {
  const p = href.split(/[?#]/)[0] || "/";
  // An annonce's id is digits and dashes too: masked segment by segment, a uuid stays.
  const masked = p.split("/").map((seg) => (isUuid(seg) ? seg : maskPersonal(seg))).join("/");
  return masked.trim().slice(0, 200) || "/";
}

/** A text parameter: a uuid as is, anything else without a phone number or an e-mail. */
function cleanText(v: string, max: number): string {
  return isUuid(v) ? v : cleanSearchTerm(v).slice(0, max);
}

/**
 * Parameters as stored: strings (100 characters at most, no phone or e-mail),
 * finite numbers, booleans and short lists of strings. Everything else is
 * dropped, as is anything past the size cap.
 */
export function cleanParams(params: EventParams | Record<string, unknown> | undefined): QueuedEvent["p"] {
  const out: QueuedEvent["p"] = {};
  if (!params) return out;
  for (const [k, v] of Object.entries(params)) {
    if (!/^[a-z][a-z0-9_]{0,29}$/.test(k)) continue;
    if (typeof v === "string") {
      const s = cleanText(v, 100);
      if (s) out[k] = s;
    } else if (typeof v === "number") {
      if (Number.isFinite(v)) out[k] = Math.round(v * 100) / 100;
    } else if (typeof v === "boolean") {
      out[k] = v;
    } else if (Array.isArray(v)) {
      const list = v.filter((x): x is string => typeof x === "string").map((x) => cleanText(x, 60)).filter(Boolean).slice(0, 40);
      if (list.length) out[k] = list;
    }
    if (JSON.stringify(out).length > MAX_PARAM_BYTES) {
      delete out[k];
      break;
    }
  }
  return out;
}

/** What Google receives: the same parameters, lists joined (GA takes no arrays). */
export function gaParams(p: QueuedEvent["p"]): EventParams {
  const out: EventParams = {};
  for (const [k, v] of Object.entries(p)) out[k] = Array.isArray(v) ? v.slice(0, 20).join(",") : v;
  return out;
}

// ── The decision to send ─────────────────────────────────────────────────────

export type FirstPartyConfig = {
  /** analytics_events_enabled */
  enabled: boolean;
  /** analytics_events_consent: wait for the visitor's yes (when asked). */
  waitForConsent: boolean;
  /** analytics_ask_consent */
  askConsent: boolean;
  /** The visitor's answer, null before any, "unknown" before hydration. */
  consent: "granted" | "denied" | null | "unknown";
};

/** Whether the site's own count may receive events now: true, false, or null while nobody knows yet. */
export function firstPartyAllowed(c: FirstPartyConfig): boolean | null {
  if (!c.enabled) return false;
  if (c.consent === "unknown") return null;
  if (c.consent === "denied") return false;
  if (c.waitForConsent && c.askConsent && c.consent !== "granted") return c.consent === null ? null : false;
  return true;
}

// ── The queue ────────────────────────────────────────────────────────────────

let config: FirstPartyConfig | null = null;
let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let hooked = false;

/** The provider (src/components/analytics/FirstPartyEvents.tsx) tells the queue what the settings and the visitor say. */
export function configureFirstParty(next: FirstPartyConfig): void {
  config = next;
  const allowed = firstPartyAllowed(next);
  if (allowed === false) queue = [];
  else if (allowed === true && queue.length) schedule(0);
}

/** For tests: forget everything. */
export function resetFirstParty(): void {
  config = null;
  queue = [];
  last = null;
  if (timer) clearTimeout(timer);
  timer = null;
}

export function pendingFirstParty(): readonly QueuedEvent[] {
  return queue;
}

function schedule(ms: number) {
  if (typeof window === "undefined") return;
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    flushFirstParty();
  }, ms);
}

function hookUnload() {
  if (hooked || typeof window === "undefined") return;
  hooked = true;
  const onHide = () => {
    if (document.visibilityState === "hidden") flushFirstParty();
  };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", () => flushFirstParty());
}

/** A random id this browser keeps once the visitor accepted analytics; null otherwise. */
export function clientId(consented: boolean): string | null {
  if (!consented || typeof window === "undefined") return null;
  try {
    const existing = localStorage.getItem("mazed-cid");
    if (existing && /^[a-z0-9]{10,32}$/.test(existing)) return existing;
    const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join("");
    localStorage.setItem("mazed-cid", id);
    return id;
  } catch {
    return null;
  }
}

/** What a batch looks like on the wire. */
export type Batch = { cid?: string; events: QueuedEvent[] };

export function buildBatch(events: readonly QueuedEvent[], now: number, cid: string | null): Batch {
  const out: Batch = { events: events.slice(0, MAX_BATCH).map((e) => ({ ...e, t: Math.max(0, now - e.t) })) };
  if (cid) out.cid = cid;
  return out;
}

/** Sends what waited, in one request. Nothing while the answer is unknown. */
export function flushFirstParty(): void {
  if (typeof window === "undefined" || !config || queue.length === 0) return;
  const allowed = firstPartyAllowed(config);
  if (allowed === null) return;
  if (allowed === false) {
    queue = [];
    return;
  }
  const events = queue.splice(0, MAX_BATCH);
  const body = JSON.stringify(buildBatch(events, Date.now(), clientId(config.consent === "granted")));
  try {
    const sent = typeof navigator.sendBeacon === "function" && navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" }));
    if (!sent) void fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {
    /* a count lost is not the visitor's problem */
  }
  if (queue.length) schedule(FLUSH_MS);
}

/**
 * Records one event: Google (when loaded) and the site's own count. `ids`
 * name the annonce or the agence it is about, for the counts per annonce.
 * Options: `firstParty: false` when the server records the same fact itself
 * (a sign-up, a receipt sent), `ga: false` for what Google must not get.
 */
// The same event twice within a breath — an effect React ran twice, a
// component mounted in two layouts — is one event.
let last: { key: string; at: number } | null = null;
const REPEAT_MS = 400;

export function trackEvent(
  name: EventName,
  params: EventParams | Record<string, unknown> = {},
  ids: Ids = {},
  options: { firstParty?: boolean; ga?: boolean } = {},
): void {
  if (typeof window === "undefined") return;
  if (isConsolePath(window.location.pathname)) return;
  const p = cleanParams(params);
  const key = `${name}|${JSON.stringify(p)}|${ids.listing ?? ""}|${ids.shop ?? ""}`;
  const now = Date.now();
  if (last && last.key === key && now - last.at < REPEAT_MS) return;
  last = { key, at: now };
  if (options.ga !== false) {
    const forGa = gaParams(p);
    if (ids.listing) forGa.listing_id = ids.listing;
    if (ids.shop) forGa.shop_id = ids.shop;
    track(name, forGa);
  }
  if (options.firstParty === false) return;
  const ev: QueuedEvent = { n: name, p, t: Date.now(), path: cleanPath(window.location.pathname) };
  if (isUuid(ids.listing)) ev.listing = ids.listing;
  if (isUuid(ids.shop)) ev.shop = ids.shop;
  if (queue.length >= MAX_QUEUE) queue.shift();
  queue.push(ev);
  hookUnload();
  if (config && firstPartyAllowed(config) === true) schedule(queue.length >= MAX_BATCH ? 0 : FLUSH_MS);
}

// ── Impressions ──────────────────────────────────────────────────────────────

const seenImpressions = new Set<string>();

/**
 * Annonces shown in a rail or a grid, once each per page view and surface,
 * as one event carrying the ids. The page's own count unfolds them per
 * annonce; Google gets the surface and the number.
 */
export function trackImpressions(ids: readonly string[], surface: string): void {
  const fresh = ids.filter((id) => isUuid(id) && !seenImpressions.has(`${surface}:${id}`));
  if (fresh.length === 0) return;
  for (const id of fresh) seenImpressions.add(`${surface}:${id}`);
  trackEvent("listing_impression", { surface, count: fresh.length }, {}, { firstParty: false });
  trackEvent("listing_impression", { surface, count: fresh.length, ids: fresh }, {}, { ga: false });
}

/** For tests and the next page: what was shown is shown again. */
export function resetImpressions(): void {
  seenImpressions.clear();
}
