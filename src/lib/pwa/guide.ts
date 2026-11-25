/**
 * The install guide's plan (2026-11-25): which window, which pictures, in
 * which order, for the visitor's phone and browser (src/lib/pwa/context.ts).
 *
 * The owner: first « open it in your browser » for the people inside Facebook,
 * Instagram, Messenger or TikTok (nothing installs there), then the install
 * window, both in the middle of the screen, with step-by-step pictures that
 * look like the real phone and a red circle on what to tap.
 *
 * Pure: the context in, the plan out. Each step is a picture
 * (src/components/layout/install/Scene.tsx) and the key of its sentence
 * under `installGuide.steps`.
 */
import type { InstallContext } from "./context";

export type GuideScene =
  | "safari-bar"
  | "safari-menu"
  | "ios-share-sheet"
  | "ios-add-dialog"
  | "ios-share-bar-old"
  | "chrome-ios-bar"
  | "chrome-android-bar"
  | "chrome-android-menu"
  | "android-install-dialog"
  | "samsung-bar"
  | "samsung-menu"
  | "inapp-ios-bar"
  | "inapp-ios-menu"
  | "inapp-android-bar"
  | "inapp-android-menu";

export type GuideStep = { scene: GuideScene; text: string };

export type GuidePlan =
  | { mode: "none" }
  | {
      mode: "open-browser";
      /** Android: one tap opens the page in Chrome (an intent); the steps are the way by hand. */
      primary: "open-chrome" | null;
      /** iPhone: copying the link to paste it in Safari is the way round. */
      copy: boolean;
      steps: GuideStep[];
    }
  | {
      mode: "install";
      /** Chrome / Edge on Android offered their own prompt: one button. */
      primary: "prompt" | null;
      steps: GuideStep[];
      /** iPhone Safari: the other generation's steps, a tap away (the version is a guess). */
      alt: { label: "older" | "newer"; steps: GuideStep[] } | null;
    };

/**
 * Safari's major version from its user agent (« Version/26.1 »). iOS 26 froze
 * the system version in the user agent at 18_6, so Safari's own number is the
 * one that tells iOS 26 from 18. Null when there is none (Chrome for iOS…).
 */
export function safariMajor(ua: string): number | null {
  const m = /Version\/(\d+)/.exec(ua);
  return m ? Number(m[1]) : null;
}

const SAFARI_26: GuideStep[] = [
  { scene: "safari-bar", text: "safari1" },
  { scene: "safari-menu", text: "safari2" },
  { scene: "ios-share-sheet", text: "share3" },
  { scene: "ios-add-dialog", text: "add4" },
];

const SAFARI_OLD: GuideStep[] = [
  { scene: "ios-share-bar-old", text: "safariOld1" },
  { scene: "ios-share-sheet", text: "share3" },
  { scene: "ios-add-dialog", text: "add4" },
];

export function guidePlan(ctx: InstallContext, opts: { promptReady: boolean; safariMajor: number | null }): GuidePlan {
  if (ctx.os === "other") return { mode: "none" };

  if (ctx.browser === "inapp") {
    return ctx.os === "android"
      ? {
          mode: "open-browser",
          primary: "open-chrome",
          copy: false,
          steps: [
            { scene: "inapp-android-bar", text: "inappAndroid1" },
            { scene: "inapp-android-menu", text: "inappAndroid2" },
          ],
        }
      : {
          mode: "open-browser",
          primary: null,
          copy: true,
          steps: [
            { scene: "inapp-ios-bar", text: "inappIos1" },
            { scene: "inapp-ios-menu", text: "inappIos2" },
          ],
        };
  }

  if (ctx.os === "android") {
    if (opts.promptReady) return { mode: "install", primary: "prompt", steps: [{ scene: "android-install-dialog", text: "prompt1" }], alt: null };
    if (ctx.browser === "samsung")
      return {
        mode: "install",
        primary: null,
        steps: [
          { scene: "samsung-bar", text: "samsung1" },
          { scene: "samsung-menu", text: "samsung2" },
        ],
        alt: null,
      };
    return {
      mode: "install",
      primary: null,
      steps: [
        { scene: "chrome-android-bar", text: "chrome1" },
        { scene: "chrome-android-menu", text: "chrome2" },
        { scene: "android-install-dialog", text: "chrome3" },
      ],
      alt: null,
    };
  }

  // iPhone / iPad.
  if (ctx.browser === "safari" || ctx.browser === "other") {
    const old = opts.safariMajor !== null && opts.safariMajor < 26;
    return old
      ? { mode: "install", primary: null, steps: SAFARI_OLD, alt: { label: "newer", steps: SAFARI_26 } }
      : { mode: "install", primary: null, steps: SAFARI_26, alt: { label: "older", steps: SAFARI_OLD } };
  }
  return {
    mode: "install",
    primary: null,
    steps: [
      { scene: "chrome-ios-bar", text: "iosOther1" },
      { scene: "ios-share-sheet", text: "share3" },
      { scene: "ios-add-dialog", text: "add4" },
    ],
    alt: null,
  };
}

/** The flag carried from the in-app browser to the real one, so the install window greets them there. */
export const OPENED_FLAG = "mz_open";

/** The page's address with the flag added (what Chrome or Safari opens). */
export function withOpenedFlag(href: string): string {
  const u = new URL(href);
  u.searchParams.set(OPENED_FLAG, "1");
  return u.toString();
}

/** The address without the flag (put back once it was read). */
export function withoutOpenedFlag(href: string): string {
  const u = new URL(href);
  u.searchParams.delete(OPENED_FLAG);
  return u.toString();
}

/**
 * How often « open in your browser » may show: once a visit, and a few times
 * a week in all (the owner: not inescapable, and not shown so often it annoys).
 * `times` are the past showings (ms), newest last.
 */
export function mayShowOpenBrowser(times: number[], now: number, maxPerWeek: number, shownThisVisit: boolean): boolean {
  if (shownThisVisit) return false;
  const week = 7 * 24 * 3600_000;
  return times.filter((t) => now - t < week).length < maxPerWeek;
}
