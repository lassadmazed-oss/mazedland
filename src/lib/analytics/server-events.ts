import { createHash } from "node:crypto";
import { after, type NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { log } from "@/lib/log";
import { TUNISIAN_GOVERNORATES } from "@/lib/tunisia";
import { cleanParams, cleanPath, EVENT_NAME_PATTERN, isUuid, MAX_BATCH, type EventName, type QueuedEvent } from "./events";

/**
 * The server side of the site's own count (0204 site_events).
 *
 * `rowsFromBatch` turns what /api/events received into rows;
 * `recordServerEvent` is for a route that knows a fact the browser does not
 * send twice — a sign-up, a login, a receipt handed in — so it is counted
 * once, from the server, whatever the browser did.
 *
 * Nothing personal lands in the table: the browser string becomes a device
 * class, the address a key that changes every day (salted and hashed), and
 * the path loses its query string. What the aggregations group or cast is
 * checked here — a governorate off the list, a deal that is neither sale nor
 * rent, a result count that is not a number, are dropped from the event.
 * Every insert is fire-and-forget.
 */
const eLog = log.scope("events");

export type Device = "phone" | "tablet" | "desktop" | "unknown";

/** A device class from a browser string, or `bot` for a crawler (not counted). */
export function deviceOf(ua: string | null | undefined): Device | "bot" {
  if (!ua) return "unknown";
  if (/bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegrambot|preview|headlesschrome|lighthouse|pingdom|uptime/i.test(ua)) return "bot";
  if (/iPad|Tablet|PlayBook|Silk|(?:Android(?!.*Mobile))/i.test(ua)) return "tablet";
  if (/Mobi|iPhone|iPod|Android|Windows Phone|BlackBerry|Opera Mini/i.test(ua)) return "phone";
  if (/Mozilla|Opera|Chrome|Safari|Firefox|Edg/i.test(ua)) return "desktop";
  return "unknown";
}

/** The locale a path is under, if any. */
export function localeOf(path: string | null | undefined): "fr" | "ar" | null {
  const m = (path ?? "").match(/^\/(fr|ar)(?:\/|$)/i);
  return m ? (m[1].toLowerCase() as "fr" | "ar") : null;
}

/**
 * A visitor's key for one day: the address and the browser, salted with a
 * server secret and the day, hashed. The same person is the same key until
 * midnight and nobody can turn it back into an address.
 */
export function dailyVisitorKey(ip: string, ua: string | null | undefined, day: string, salt: string): string {
  const h = createHash("sha256").update(`${salt}:${day}:${ip}:${ua ?? ""}`).digest("base64url");
  return `a:${h.slice(0, 24)}`;
}

/** A batch as a browser sent it, checked field by field; anything odd is left out. Pure. */
export function readBatch(body: unknown): { cid: string | null; events: QueuedEvent[] } {
  const b = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const cid = typeof b.cid === "string" && /^[a-z0-9]{10,32}$/.test(b.cid) ? b.cid : null;
  const raw = Array.isArray(b.events) ? b.events.slice(0, MAX_BATCH) : [];
  const events: QueuedEvent[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const ev = e as Record<string, unknown>;
    if (typeof ev.n !== "string" || !EVENT_NAME_PATTERN.test(ev.n)) continue;
    const p = ev.p && typeof ev.p === "object" && !Array.isArray(ev.p) ? (ev.p as QueuedEvent["p"]) : {};
    events.push({
      n: ev.n,
      p,
      t: typeof ev.t === "number" ? ev.t : 0,
      path: typeof ev.path === "string" ? ev.path : "/",
      listing: typeof ev.listing === "string" ? ev.listing : undefined,
      shop: typeof ev.shop === "string" ? ev.shop : undefined,
    });
  }
  return { cid, events };
}

const GOVERNORATES: ReadonlySet<string> = new Set(TUNISIAN_GOVERNORATES);
const MAX_RESULTS = 1_000_000;

/**
 * The parameters the aggregations group or cast, checked: `results` a whole
 * number (0 to a million), `gov` a governorate of the list, `deal` sale or
 * rent, `cat` a category slug when the list is known. An unknown value is
 * dropped; the event stays. Pure.
 */
export function cleanServerParams(params: QueuedEvent["p"], categories?: ReadonlySet<string>): QueuedEvent["p"] {
  const out: QueuedEvent["p"] = { ...params };
  if ("results" in out) {
    const n = Number(out.results);
    if (Number.isInteger(n) && n >= 0 && n <= MAX_RESULTS) out.results = n;
    else delete out.results;
  }
  if ("gov" in out && !(typeof out.gov === "string" && GOVERNORATES.has(out.gov))) delete out.gov;
  if ("deal" in out && out.deal !== "sale" && out.deal !== "rent") delete out.deal;
  if ("cat" in out && categories && !(typeof out.cat === "string" && categories.has(out.cat))) delete out.cat;
  return out;
}

export type EventRow = {
  name: string;
  listing_id: string | null;
  shop_id: string | null;
  user_id: string | null;
  visitor_key: string | null;
  locale: "fr" | "ar" | null;
  device: Device;
  path: string | null;
  params: QueuedEvent["p"];
  created_at?: string;
};

/** A batch's events as rows, with the server-side facts filled in. Pure. */
export function rowsFromBatch(
  events: readonly QueuedEvent[],
  ctx: { userId: string | null; visitorKey: string | null; device: Device; now: number; categories?: ReadonlySet<string> },
): EventRow[] {
  return events.map((e) => ({
    name: e.n,
    listing_id: isUuid(e.listing) ? e.listing : null,
    shop_id: isUuid(e.shop) ? e.shop : null,
    user_id: ctx.userId,
    visitor_key: ctx.visitorKey,
    locale: localeOf(e.path),
    device: ctx.device,
    path: cleanPath(e.path ?? "/"),
    params: cleanServerParams(cleanParams(e.p), ctx.categories),
    // `t` is how long before the batch left the browser; 0 is the send itself.
    created_at: new Date(ctx.now - Math.min(Math.max(0, Number(e.t) || 0), 600_000)).toISOString(),
  }));
}

/** Inserts rows with the service client, never throwing. */
export async function insertEventRows(rows: readonly EventRow[]): Promise<void> {
  if (rows.length === 0) return;
  const admin = getServiceSupabase();
  if (!admin) return;
  const { error } = await admin.from("site_events").insert(rows as EventRow[]);
  if (error) eLog.warn(`insert failed: ${error.message}`);
}

/**
 * Runs the insert once the response is out, so the function is not frozen
 * before the row lands — `after()` inside a request, a plain promise elsewhere.
 */
function later(work: () => Promise<void>): void {
  try {
    after(work);
  } catch {
    void work();
  }
}

/**
 * One fact the server knows, counted once. `req` gives the device and the
 * path (the referer); `userId` the account it is about. Fire-and-forget.
 */
export function recordServerEvent(
  req: NextRequest | null,
  name: EventName,
  input: { userId?: string | null; listingId?: string | null; shopId?: string | null; params?: Record<string, unknown>; path?: string | null } = {},
): void {
  const ua = req?.headers.get("user-agent") ?? null;
  const device = deviceOf(ua);
  if (device === "bot") return;
  let path = input.path ?? null;
  if (!path && req) {
    const ref = req.headers.get("referer");
    if (ref) {
      try {
        path = new URL(ref).pathname;
      } catch {
        path = null;
      }
    }
  }
  const row: EventRow = {
    name,
    listing_id: isUuid(input.listingId) ? input.listingId : null,
    shop_id: isUuid(input.shopId) ? input.shopId : null,
    user_id: isUuid(input.userId) ? input.userId : null,
    visitor_key: isUuid(input.userId) ? `u:${input.userId}` : null,
    locale: localeOf(path),
    device,
    path: path ? cleanPath(path) : null,
    params: cleanServerParams(cleanParams(input.params)),
  };
  later(() => insertEventRows([row]));
}
