/**
 * Google Analytics 4 in the browser: the visitor's answer to the consent bar,
 * the events a component sends, and the rules both follow. The loader itself
 * is src/components/analytics/GoogleAnalytics.tsx.
 *
 * Nothing here talks to Google on its own. `track()` hands an event to
 * `window.gtag`, which exists only once the loader ran — so with Analytics
 * off, no ID, no consent or on the console, every call is a no-op.
 *
 * An event says what happened, never who did it: an annonce's id, a search's
 * words, which button — no name, phone number or e-mail. `cleanSearchTerm`
 * takes out what looks like either before a search leaves the browser.
 */

/** A GA4 measurement ID, as the property shows it: « G-XXXXXXXXXX ». */
export const GA_ID_PATTERN = /^G-[A-Z0-9]{4,16}$/;

export function gaIdOrNull(raw: string | null | undefined): string | null {
  const id = (raw ?? "").trim().toUpperCase();
  return GA_ID_PATTERN.test(id) ? id : null;
}

/** The console (`/fr/admin/…`), which is never measured. */
export function isConsolePath(pathname: string): boolean {
  let p = pathname;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    /* a malformed escape: judged as written */
  }
  const parts = p.toLowerCase().split("/").filter(Boolean);
  return parts[0] === "admin" || parts[1] === "admin";
}

/**
 * What runs before gtag.js: the queue, consent defaults and the config.
 * Advertising signals are always refused — the site shows no Google ads — and
 * the property's own page_view on load and on each history change (GA4's
 * enhanced measurement) counts App Router navigations.
 *
 * The console must stay out even after a soft navigation into it, and
 * gtag.js catches those by wrapping history.pushState itself. Google's own
 * switch, `window['ga-disable-<ID>']`, is read before every hit, so this sets
 * it from the new address inside the same pushState call — before gtag.js,
 * which wraps around this later, looks at the change. `__mazedGaOff` is a
 * « no » given after Google loaded, which a navigation must not undo;
 * `__mazedGaSync` lets the loader apply one.
 *
 * Leaving the console is the other way in: GA4 sends the next page with the
 * previous address as its referrer, and ignores any override on those
 * history page views (checked on www.mazed.immo) — so an admin's
 * `/admin/vendeurs?q=<a seller's number>` would reach Google that way. The
 * page is loaded afresh instead, Google staying off until it goes.
 *
 * The first page view is the one Google lets us correct: when its address
 * or referrer holds the console, a phone-like number or an e-mail, the
 * config sends a cleaned copy (same masks as cleanSearchTerm).
 * Same test of the path as isConsolePath.
 */
export function gaInitScript(id: string): string {
  const ID = JSON.stringify(id);
  return String.raw`window.dataLayer=window.dataLayer||[];
function gtag(){dataLayer.push(arguments);}
window.gtag=gtag;
gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'granted'});
gtag('js',new Date());
(function(){
var off='ga-disable-'+${ID};
function adm(path){var p=String(path).toLowerCase().split('/').filter(Boolean);return p[0]==='admin'||p[1]==='admin';}
function mask(v){return v.replace(/[^\s@]+@[^\s@]+/g,'[email]').replace(/\+?\d[\d\s.-]{6,}\d/g,function(m){return m.replace(/\D/g,'').length>=8?'[phone]':m;});}
function clean(href){try{var u=new URL(href,location.href);if(u.origin!==location.origin)return '';if(adm(u.pathname))return u.origin+'/';var changed=false,out=[];u.searchParams.forEach(function(v,k){var m=mask(v);if(m!==v)changed=true;out.push(encodeURIComponent(k)+'='+encodeURIComponent(m));});return changed?u.origin+u.pathname+'?'+out.join('&'):'';}catch(e){return '';}}
var here=location.pathname,leaving=false;
function apply(){if(!leaving)window[off]=window.__mazedGaOff===true||adm(location.pathname);}
function sync(){if(leaving)return;var now=location.pathname;if(adm(here)&&!adm(now)){leaving=true;window[off]=true;location.reload();return;}here=now;apply();}
window.__mazedGaSync=apply;
['pushState','replaceState'].forEach(function(m){var o=history[m];history[m]=function(){var r=o.apply(this,arguments);sync();return r;};});
addEventListener('popstate',sync,true);
sync();
var cfg={allow_google_signals:false,allow_ad_personalization_signals:false};
var l=clean(location.href);if(l)cfg.page_location=l;
var r=document.referrer&&clean(document.referrer);if(r)cfg.page_referrer=r;
gtag('config',${ID},cfg);
})();`;
}

// ── The visitor's answer ─────────────────────────────────────────────────────

export type Consent = "granted" | "denied";

const CONSENT_KEY = "mazed-analytics-consent";
const listeners = new Set<() => void>();

export function readConsent(): Consent | null {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === "granted" || v === "denied" ? v : null;
  } catch {
    return null;
  }
}

export function writeConsent(v: Consent): void {
  try {
    localStorage.setItem(CONSENT_KEY, v);
  } catch {
    /* private window: the answer lasts as long as the page */
  }
  memory = v;
  for (const fn of listeners) fn();
}

// The answer of a browser that cannot store it, for the rest of the visit.
let memory: Consent | null = null;

export function currentConsent(): Consent | null {
  return readConsent() ?? memory;
}

export function subscribeConsent(fn: () => void): () => void {
  listeners.add(fn);
  // Answered in another tab.
  const onStorage = (e: StorageEvent) => {
    if (e.key === CONSENT_KEY) fn();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Whether Google may load for this visitor. Asking: only after a yes. Not
 * asking: unless they said no on the privacy page.
 */
export function gaAllowed(opts: { enabled: boolean; id: string | null; askConsent: boolean; consent: Consent | null }): boolean {
  if (!opts.enabled || !opts.id) return false;
  return opts.askConsent ? opts.consent === "granted" : opts.consent !== "denied";
}

// ── Events ───────────────────────────────────────────────────────────────────

export type EventParams = Record<string, string | number | boolean | undefined>;

type Gtag = (...args: unknown[]) => void;
type GaWindow = Window & { gtag?: Gtag };

// Events sent before gtag exists — a search on the page that loads it — wait
// here until the loader is ready, or are dropped if it never loads.
const pending: [string, EventParams][] = [];
const MAX_PENDING = 20;

export function track(name: string, params: EventParams = {}): void {
  if (typeof window === "undefined" || isConsolePath(window.location.pathname)) return;
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== ""));
  const gtag = (window as GaWindow).gtag;
  if (typeof gtag === "function") {
    // What waited goes first, so the order stays the order things happened.
    flushPending();
    gtag("event", name, clean);
    return;
  }
  if (pending.length < MAX_PENDING) pending.push([name, clean]);
}

/** The loader is ready: what waited goes out, in order. */
export function flushPending(): void {
  const gtag = (window as GaWindow).gtag;
  if (typeof gtag !== "function") return;
  for (const [name, params] of pending.splice(0)) gtag("event", name, params);
}

/** Google will not load (off, or no consent): what waited is forgotten, never sent later. */
export function dropPending(): void {
  pending.length = 0;
}

// Eight digits or more in a row, spaces and dots allowed: a phone number
// (« 20 123 456 », « +216 20123456 »). A price is seven at most.
const PHONE_LIKE = /\+?\d[\d\s.-]{6,}\d/g;
const EMAIL_LIKE = /[^\s@]+@[^\s@]+/g;

/** A text without what could be a phone number or an e-mail, whatever its length. */
export function maskPersonal(raw: string | null | undefined): string {
  return (raw ?? "")
    .replace(EMAIL_LIKE, "[email]")
    .replace(PHONE_LIKE, (m) => (m.replace(/\D/g, "").length >= 8 ? "[phone]" : m));
}

/** A search's words, without what could be a phone number or an e-mail. */
export function cleanSearchTerm(raw: string | null | undefined): string {
  return maskPersonal(raw).replace(/\s+/g, " ").trim().slice(0, 100);
}
