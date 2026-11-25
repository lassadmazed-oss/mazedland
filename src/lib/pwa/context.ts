/**
 * Who is about to install the app, and from where (the install sheet, 2026-11-25).
 *
 * The owner: every visitor who comes from an ad should be asked to install
 * Mazed as an app, with the steps of THEIR phone and browser. Three worlds:
 *
 *   in-app   Facebook, Instagram, Messenger, TikTok open links in their own
 *            browser, where nothing can be installed: on Android a link opens
 *            Chrome directly (an intent), on iPhone the person must tap
 *            « Ouvrir dans le navigateur » (Apple gives no way round it).
 *   android  Chrome and Edge offer the native prompt; Samsung Internet,
 *            Firefox and Opera install from their menu.
 *   ios      Safari (iOS 26: ••• → Partager → Sur l'écran d'accueil, « app web »
 *            on by default; older: the Share button), and Chrome / Edge /
 *            Firefox for iOS, which add to the Home Screen from their Share button.
 *
 * Pure: the user agent and the address in, the answer out.
 */
export type InstallOs = "ios" | "android" | "other";
export type InstallBrowser = "safari" | "chrome" | "edge" | "firefox" | "samsung" | "opera" | "inapp" | "other";
export type InstallContext = { os: InstallOs; browser: InstallBrowser; app: "facebook" | "instagram" | "messenger" | "tiktok" | null };

const IN_APP: { app: NonNullable<InstallContext["app"]>; re: RegExp }[] = [
  { app: "messenger", re: /Messenger|MessengerForiOS|Orca-Android/i },
  { app: "instagram", re: /Instagram/i },
  { app: "facebook", re: /FBAN|FBAV|FB_IAB|FB4A|FBIOS/i },
  { app: "tiktok", re: /musical_ly|BytedanceWebview|TikTok/i },
];

export function installContext(ua: string, opts: { touchMac?: boolean } = {}): InstallContext {
  const ios = /iPhone|iPad|iPod/i.test(ua) || opts.touchMac === true;
  const android = !ios && /Android/i.test(ua);
  const os: InstallOs = ios ? "ios" : android ? "android" : "other";
  const inApp = IN_APP.find((x) => x.re.test(ua))?.app ?? null;
  if (inApp) return { os, browser: "inapp", app: inApp };
  let browser: InstallBrowser = "other";
  if (ios) {
    if (/CriOS/i.test(ua)) browser = "chrome";
    else if (/EdgiOS/i.test(ua)) browser = "edge";
    else if (/FxiOS/i.test(ua)) browser = "firefox";
    else if (/OPiOS|OPT\//i.test(ua)) browser = "opera";
    else if (/Safari/i.test(ua)) browser = "safari";
  } else {
    if (/SamsungBrowser/i.test(ua)) browser = "samsung";
    else if (/EdgA|Edg\//i.test(ua)) browser = "edge";
    else if (/Firefox|FxAndroid/i.test(ua)) browser = "firefox";
    else if (/OPR\/|Opera/i.test(ua)) browser = "opera";
    else if (/Chrome\//i.test(ua)) browser = "chrome";
    else if (/Safari/i.test(ua)) browser = "safari";
  }
  return { os, browser, app: null };
}

const AD_CLICK_IDS = ["fbclid", "gclid", "gbraid", "wbraid", "ttclid", "igshid"];
const PAID_MEDIUMS = new Set(["paid", "cpc", "ppc", "ads", "ad", "paid_social", "paidsocial", "social_paid", "sponsored", "display"]);
const AD_SOURCES = new Set(["facebook", "fb", "instagram", "ig", "meta", "messenger", "tiktok", "google_ads", "adwords"]);

/**
 * A visit that came from an ad or a social post: a click id the platforms add
 * (fbclid, gclid, ttclid…), a paid or social `utm_*`, or a link opened inside
 * Facebook, Instagram, Messenger or TikTok.
 */
export function fromAd(search: string, ua: string): boolean {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (AD_CLICK_IDS.some((k) => q.has(k))) return true;
  const medium = (q.get("utm_medium") ?? "").toLowerCase();
  const source = (q.get("utm_source") ?? "").toLowerCase();
  if (PAID_MEDIUMS.has(medium) || AD_SOURCES.has(source)) return true;
  return installContext(ua).app !== null;
}

/**
 * The same page opened in Chrome, from an Android in-app browser: an intent
 * link, which falls back to the page itself where Chrome is missing.
 */
export function chromeIntentUrl(href: string): string {
  const u = new URL(href);
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.replace(":", "")};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(href)};end`;
}

/** Which steps the sheet shows. */
export type InstallSteps = "inapp-ios" | "inapp-android" | "android-prompt" | "android-menu" | "ios-safari" | "ios-other" | "none";

export function installSteps(ctx: InstallContext, promptReady: boolean): InstallSteps {
  if (ctx.os === "other") return "none";
  if (ctx.browser === "inapp") return ctx.os === "ios" ? "inapp-ios" : "inapp-android";
  if (ctx.os === "android") return promptReady ? "android-prompt" : "android-menu";
  return ctx.browser === "safari" || ctx.browser === "other" ? "ios-safari" : "ios-other";
}
