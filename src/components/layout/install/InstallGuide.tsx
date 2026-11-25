"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { Check, ChevronLeft, ChevronRight, Copy, Ellipsis, EllipsisVertical, ExternalLink, Menu, Share, SquarePlus, X, type LucideIcon } from "lucide-react";
import { usePathname } from "@/i18n/navigation";
import { useSetting } from "@/components/settings/SettingsProvider";
import { trackEvent } from "@/lib/analytics/events";
import { chromeIntentUrl, fromAd, installContext, installSteps, type InstallContext } from "@/lib/pwa/context";
import { guidePlan, mayShowOpenBrowser, OPENED_FLAG, safariMajor, withOpenedFlag, withoutOpenedFlag, type GuideStep } from "@/lib/pwa/guide";
import { promptInstall, useInstallState } from "../InstallButton";
import { Scene, SCENE_H, type SceneLabels } from "./Scene";

/**
 * The install guide (2026-11-25), a window in the middle of the screen. It
 * replaced the bottom sheet of the same day; the owner: « before the install
 * popup, the popup to open it in the browser — not inescapable, not shown so
 * often it annoys — and step-by-step pictures like the real phone, with a red
 * circle ».
 *
 *   1. Inside Facebook / Instagram / Messenger / TikTok nothing installs, so the
 *      window asks to open the page in the real browser: on Android one tap
 *      (a Chrome intent), on iPhone the two taps in pictures (••• → « Ouvrir
 *      dans le navigateur ») or the link copied. Once a visit, a few times a
 *      week at most (Réglages → Fonctions), always with « Plus tard ».
 *   2. In the browser (the page arrives with ?mz_open=1 from step 1, so it
 *      greets them at once) or for any ad visitor: the install window, the
 *      steps of THEIR phone in pictures (src/lib/pwa/guide.ts), a red circle
 *      on what to tap; Chrome / Edge on Android get the one-tap prompt.
 *
 * Never in the app itself or in the console. The counters are the bottom
 * sheet's, so a phone that saw it is not asked again sooner.
 */

const AD_KEY = "mz_ad_until";
const SHOWS_KEY = "mz_install_shows";
const LAST_KEY = "mz_install_last";
const OB_TIMES_KEY = "mz_open_browser_times";
const OB_VISIT_KEY = "mz_open_browser_visit";
const WEEK = 7 * 24 * 3600_000;
const GAP = 20 * 3600_000;
const APP_NAMES = { facebook: "Facebook", instagram: "Instagram", messenger: "Messenger", tiktok: "TikTok" } as const;

function storage(kind: "local" | "session"): Storage | null {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}
const readNum = (k: string) => Number(storage("local")?.getItem(k) ?? 0) || 0;
function write(k: string, v: string, kind: "local" | "session" = "local") {
  try {
    storage(kind)?.setItem(k, v);
  } catch {
    /* private mode: the window may just show again later */
  }
}
function readTimes(): number[] {
  try {
    const v = JSON.parse(storage("local")?.getItem(OB_TIMES_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is number => typeof x === "number") : [];
  } catch {
    return [];
  }
}

function replaceUrl(href: string) {
  try {
    if (href !== window.location.href) window.history.replaceState(null, "", href);
  } catch {
    /* the address stays as it is */
  }
}

export default function InstallGuide() {
  const t = useTranslations("installGuide");
  const ts = useTranslations("installGuide.scene");
  const rtl = useLocale() === "ar";
  const id = useId();
  const pathname = usePathname();
  const installOn = useSetting("install_sheet_enabled");
  const allPhones = useSetting("install_sheet_all_phones");
  const delay = useSetting("install_sheet_delay_seconds");
  const maxShows = useSetting("install_sheet_max_shows");
  const openBrowserOn = useSetting("install_open_browser_enabled");
  const openBrowserMaxWeek = useSetting("install_open_browser_max_week");
  const state = useInstallState();
  const [ctx, setCtx] = useState<InstallContext | null>(null);
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const [useAlt, setUseAlt] = useState(false);
  const [how, setHow] = useState(false);
  const [copied, setCopied] = useState(false);
  const [done, setDone] = useState(false);
  const [major, setMajor] = useState<number | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  // Once a page load at most (the header, and this, live across the visit's pages).
  const shownOnce = useRef(false);
  // The ?mz_open=1 the page arrived with, read once: the address is cleaned at once, and
  // the effect runs again when the settings or the install state arrive.
  const arrived = useRef<boolean | null>(null);

  useEffect(() => {
    if (shownOnce.current || state === "hidden" || pathname.startsWith("/admin")) return;
    const ua = navigator.userAgent;
    const c = installContext(ua, { touchMac: navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1 });
    if (c.os === "other") return;
    const now = Date.now();
    if (arrived.current === null) {
      arrived.current = new URL(window.location.href).searchParams.get(OPENED_FLAG) === "1";
      if (arrived.current && c.browser !== "inapp") replaceUrl(withoutOpenedFlag(window.location.href));
    }
    const opened = arrived.current;
    if (fromAd(window.location.search, ua)) write(AD_KEY, String(now + WEEK));

    let show: (() => void) | null = null;
    let wait = Math.max(0, delay) * 1000;

    if (c.browser === "inapp") {
      // 1. « Open it in your browser »: once a visit, a few times a week.
      if (!openBrowserOn) return;
      if (!mayShowOpenBrowser(readTimes(), now, openBrowserMaxWeek, storage("session")?.getItem(OB_VISIT_KEY) === "1")) return;
      show = () => {
        write(OB_VISIT_KEY, "1", "session");
        write(OB_TIMES_KEY, JSON.stringify([...readTimes().filter((x) => Date.now() - x < WEEK), Date.now()]));
        // What « Ouvrir dans le navigateur » opens is this address: the flag rides along.
        replaceUrl(withOpenedFlag(window.location.href));
      };
    } else if (!installOn) {
      return;
    } else if (opened) {
      // 2a. Just arrived from Facebook / Instagram: the install window greets them at once.
      wait = 900;
      show = () => {
        write(SHOWS_KEY, String(readNum(SHOWS_KEY) + 1));
        write(LAST_KEY, String(Date.now()));
        setWelcome(true);
      };
    } else {
      // 2b. Any ad visitor (or every phone, by the setting), a few times, once a day at most.
      if (!allPhones && readNum(AD_KEY) < now) return;
      if (readNum(SHOWS_KEY) >= maxShows || now - readNum(LAST_KEY) < GAP) return;
      show = () => {
        write(SHOWS_KEY, String(readNum(SHOWS_KEY) + 1));
        write(LAST_KEY, String(Date.now()));
      };
    }

    const timer = window.setTimeout(() => {
      shownOnce.current = true;
      show?.();
      setMajor(safariMajor(ua));
      setCtx(c);
      setOpen(true);
    }, wait);
    return () => window.clearTimeout(timer);
  }, [state, pathname, installOn, allPhones, delay, maxShows, openBrowserOn, openBrowserMaxWeek]);

  const plan = ctx ? guidePlan(ctx, { promptReady: state === "ready", safariMajor: major }) : ({ mode: "none" } as const);
  const flow = ctx ? installSteps(ctx, state === "ready") : "none";
  const via = plan.mode === "open-browser" ? "open_browser" : "guide";

  // Counted once it is on screen (Statistiques); the entrance after a frame; Escape closes;
  // the page behind stays still.
  useEffect(() => {
    if (!open || !ctx) return;
    trackEvent("install_shown", { via, steps: flow, app: ctx.app ?? "" });
    const enter = window.setTimeout(() => setShown(true), 20);
    dialog.current?.focus();
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(enter);
      root.style.overflow = before;
      window.removeEventListener("keydown", onKey);
    };
    // One count per opening; the plan may change while open (Chrome's prompt arriving).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || !ctx || plan.mode === "none" || (state === "hidden" && !done)) return null;

  const L: SceneLabels = {
    site: "mazed.immo",
    share: ts("share"),
    addFavorite: ts("addFavorite"),
    newTab: ts("newTab"),
    copy: ts("copy"),
    readingList: ts("readingList"),
    addHome: ts("addHome"),
    add: ts("add"),
    cancel: ts("cancel"),
    webApp: ts("webApp"),
    install: ts("install"),
    installApp: ts("installApp"),
    history: ts("history"),
    downloads: ts("downloads"),
    settings: ts("settings"),
    openBrowser: ts("openBrowser"),
    openChrome: ts("openChrome"),
    refresh: ts("refresh"),
    copyLink: ts("copyLink"),
    addPageTo: ts("addPageTo"),
    appName: ts("appName"),
  };

  const close = () => {
    setOpen(false);
    trackEvent("install_click", { via, action: "later", steps: flow });
  };

  async function install() {
    trackEvent("install_click", { via, action: "prompt", steps: flow });
    const outcome = await promptInstall();
    if (outcome === "accepted") {
      setDone(true);
      trackEvent("install_done", { via });
      window.setTimeout(() => setOpen(false), 1800);
    }
  }

  async function copy() {
    trackEvent("install_click", { via, action: "copy", steps: flow });
    try {
      await navigator.clipboard.writeText(withOpenedFlag(window.location.href));
      setCopied(true);
    } catch {
      /* nothing to copy with: the pictures still say what to do */
    }
  }

  const steps: GuideStep[] = plan.mode === "install" && useAlt && plan.alt ? plan.alt.steps : plan.steps;
  const title = done ? t("installed") : plan.mode === "open-browser" ? t("openTitle") : t("installTitle");
  const sub = plan.mode === "open-browser" ? t("openWhy", { app: APP_NAMES[ctx.app ?? "facebook"] }) : t("installSub");
  const primaryBtn = "mazed-btn-luxe tap-target inline-flex h-12 w-full items-center justify-center gap-2 rounded-full text-[15px] text-[var(--background)]";

  // On <body>, not inside the header (its own stacking context, under the bottom bar).
  return createPortal(
    <div
      className={`fixed inset-0 z-[150] grid place-items-center overscroll-contain bg-black/55 p-4 transition-opacity duration-200 ${shown ? "opacity-100" : "opacity-0"}`}
      onClick={close}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={`relative max-h-[calc(100dvh-32px)] w-full max-w-[360px] overflow-y-auto rounded-[28px] bg-surface px-5 pb-4 pt-5 shadow-[0_24px_60px_rgba(0,0,0,0.35)] outline-none transition-transform duration-200 ${shown ? "scale-100" : "scale-95"}`}
      >
        <button
          type="button"
          onClick={close}
          aria-label={t("later")}
          className="tap-target absolute end-3 top-3 grid size-9 place-items-center rounded-full text-muted transition hover:bg-surface-2 hover:text-foreground"
        >
          <X className="size-5" />
        </button>

        {/* Centred, like the phone's own dialogs: the icon, the title, one sentence. */}
        <div className="flex flex-col items-center px-4 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" width={56} height={56} className="size-14 rounded-2xl shadow-[var(--shadow-card)] ring-1 ring-border" />
          {welcome && !done && (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--tone-ok)_14%,transparent)] px-3 py-1 text-[12px] font-bold text-[var(--tone-ok)]">
              <Check className="size-3.5" />
              {t("inBrowserOk")}
            </p>
          )}
          <p id={`${id}-title`} className="mt-3 text-[18px] font-extrabold leading-tight text-foreground">
            {title}
          </p>
          {!done && <p className="mt-1.5 text-[13px] leading-snug text-muted">{sub}</p>}
        </div>

        {done ? (
          <div className="mt-5 grid place-items-center pb-2">
            <span className="grid size-14 place-items-center rounded-full bg-[color-mix(in_srgb,var(--tone-ok)_16%,transparent)] text-[var(--tone-ok)]">
              <Check className="size-7" />
            </span>
          </div>
        ) : (
          <>
            {plan.mode === "open-browser" && plan.primary === "open-chrome" && (
              <a
                href={chromeIntentUrl(withOpenedFlag(window.location.href))}
                onClick={() => trackEvent("install_click", { via, action: "open_chrome", steps: flow })}
                className={`${primaryBtn} mt-4`}
              >
                <ExternalLink className="size-5" />
                {t("openChrome")}
              </a>
            )}

            {plan.mode === "install" && plan.primary === "prompt" && (
              <button type="button" onClick={install} className={`${primaryBtn} mt-4`}>
                <SquarePlus className="size-5" />
                {t("installNow")}
              </button>
            )}

            {plan.mode === "open-browser" && plan.primary === "open-chrome" && !how ? (
              <button
                type="button"
                onClick={() => {
                  setHow(true);
                  trackEvent("install_click", { via, action: "how", steps: flow });
                }}
                className="tap-target mt-2 w-full py-2 text-[13px] font-bold text-foreground underline decoration-border underline-offset-4"
              >
                {t("openNotWorking")}
              </button>
            ) : (
              <StepCarousel key={useAlt ? "alt" : "main"} steps={steps} L={L} rtl={rtl} compact={plan.primary !== null} />
            )}

            {plan.mode === "install" && plan.alt && (
              <button
                type="button"
                onClick={() => {
                  setUseAlt((v) => !v);
                  trackEvent("install_click", { via, action: "alt", steps: flow });
                }}
                className="tap-target mt-1 w-full py-1.5 text-[12.5px] font-semibold text-muted underline decoration-border underline-offset-4 hover:text-foreground"
              >
                {t(useAlt ? (plan.alt.label === "older" ? "newer" : "older") : plan.alt.label)}
              </button>
            )}

            {plan.mode === "open-browser" && plan.copy && (
              <button type="button" onClick={copy} className="mazed-btn-quiet tap-target mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full text-[14px]">
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? t("copied") : t("copyLink")}
              </button>
            )}

            <button type="button" onClick={close} className="tap-target mt-1 w-full py-2.5 text-[13px] font-bold text-muted hover:text-foreground">
              {t("later")}
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** The button to tap, drawn inside the sentence (the ⋮ and ••• characters are missing from many fonts). */
function KeyIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="mx-0.5 inline-grid size-6 place-items-center rounded-md bg-surface-2 align-[-5px] text-foreground ring-1 ring-border">
      <Icon className="size-4" strokeWidth={2.4} />
    </span>
  );
}

/**
 * The steps as pictures, one at a time: « Étape 2 sur 4 », the sentence, the
 * phone with the red circle. They turn by themselves like a short film until
 * the visitor touches them (not with « reduce motion »); arrows, dots and a
 * swipe go back and forth.
 */
function StepCarousel({ steps, L, rtl, compact }: { steps: GuideStep[]; L: SceneLabels; rtl: boolean; compact: boolean }) {
  const t = useTranslations("installGuide");
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(true);
  const down = useRef<number | null>(null);
  const n = steps.length;

  useEffect(() => {
    if (!auto || n < 2) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setI((x) => (x + 1) % n), 4200);
    return () => window.clearInterval(timer);
  }, [auto, n]);

  const go = (to: number) => {
    setAuto(false);
    setI(Math.max(0, Math.min(n - 1, to)));
  };
  const Prev = rtl ? ChevronRight : ChevronLeft;
  const Next = rtl ? ChevronLeft : ChevronRight;
  const step = steps[i];

  return (
    <div className="mt-4">
      <div className="min-h-[44px] text-center">
        {n > 1 && <p className="mazed-tabular text-[11.5px] font-bold uppercase tracking-wide text-muted">{t("stepOf", { n: i + 1, total: n })}</p>}
        <p className="mt-0.5 text-[15px] font-extrabold leading-snug text-foreground" aria-live="polite">
          {t.rich(`steps.${step.text}`, {
            dots: () => <KeyIcon icon={Ellipsis} />,
            kebab: () => <KeyIcon icon={EllipsisVertical} />,
            share: () => <KeyIcon icon={Share} />,
            burger: () => <KeyIcon icon={Menu} />,
          })}
        </p>
      </div>

      <div
        className="relative mt-3 overflow-hidden"
        onPointerDown={(e) => {
          down.current = e.clientX;
        }}
        onPointerUp={(e) => {
          if (down.current === null) return;
          const dx = e.clientX - down.current;
          down.current = null;
          if (Math.abs(dx) < 36) return;
          // Right to left in Arabic: the next picture comes from the left.
          const forward = rtl ? dx > 0 : dx < 0;
          go(i + (forward ? 1 : -1));
        }}
        style={{ touchAction: "pan-y" }}
      >
        <div className="flex transition-transform duration-300 ease-out" style={{ transform: `translateX(${(rtl ? 1 : -1) * i * 100}%)` }}>
          {steps.map((s, k) => (
            <div key={`${s.scene}-${k}`} className="flex w-full shrink-0 justify-center" aria-hidden={k !== i}>
              <div style={{ height: compact ? "min(30vh, 250px)" : "min(36vh, 290px)", aspectRatio: `240 / ${SCENE_H}` }}>
                <Scene kind={s.scene} L={L} rtl={rtl} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {n > 1 && (
        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => go(i - 1)}
            disabled={i === 0}
            aria-label={t("prev")}
            className="tap-target grid size-10 place-items-center rounded-full text-foreground ring-1 ring-border transition hover:bg-surface-2 disabled:opacity-30"
          >
            <Prev className="size-5" />
          </button>
          <div className="flex items-center gap-1.5">
            {steps.map((_, k) => (
              <button
                key={k}
                type="button"
                onClick={() => go(k)}
                aria-label={t("stepOf", { n: k + 1, total: n })}
                aria-current={k === i ? "step" : undefined}
                className={`h-2 rounded-full transition-all ${k === i ? "w-6 bg-foreground" : "w-2 bg-border hover:bg-muted"}`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => go(i + 1)}
            disabled={i === n - 1}
            aria-label={t("next")}
            className="tap-target grid size-10 place-items-center rounded-full text-foreground ring-1 ring-border transition hover:bg-surface-2 disabled:opacity-30"
          >
            <Next className="size-5" />
          </button>
        </div>
      )}
    </div>
  );
}
