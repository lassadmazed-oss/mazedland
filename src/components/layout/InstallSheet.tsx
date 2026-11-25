"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Check, Copy, Ellipsis, EllipsisVertical, ExternalLink, Share, SquarePlus, X } from "lucide-react";
import { usePathname } from "@/i18n/navigation";
import { useSetting } from "@/components/settings/SettingsProvider";
import { trackEvent } from "@/lib/analytics/events";
import { chromeIntentUrl, fromAd, installContext, installSteps, type InstallContext, type InstallSteps } from "@/lib/pwa/context";
import { promptInstall, useInstallState } from "./InstallButton";

/**
 * « Installez l'app Mazed » — a sheet from the bottom of the phone, for the
 * visitors who came from an ad (the owner, 2026-11-25: as many installs as
 * possible from the campaigns), with the steps of THEIR phone and browser
 * (src/lib/pwa/context.ts):
 *
 *   inside Facebook / Instagram / Messenger / TikTok: nothing installs there.
 *     Android: one button opens the page in Chrome. iPhone: tap ••• then
 *     « Ouvrir dans le navigateur » (Apple gives no way round it), or copy the link.
 *   Android, Chrome / Edge: the browser's own « Installer » prompt, one tap.
 *   Android, other browsers: menu ⋮ (☰ on Samsung) → « Installer l'application ».
 *   iPhone, Safari (iOS 26): ••• next to the address → Partager → « Sur l'écran
 *     d'accueil » → keep « app web » on → Ajouter. Older iOS: the Share button.
 *   iPhone, Chrome / Edge / Firefox: Share in the address bar → « Sur l'écran d'accueil ».
 *
 * Shown once a day at most, a few times in all (Réglages → Fonctions), never
 * in the app itself or in the console. An ad arrival is remembered a week, so
 * the visitor who browses on still gets it.
 */

const AD_KEY = "mz_ad_until";
const SHOWS_KEY = "mz_install_shows";
const LAST_KEY = "mz_install_last";
const WEEK = 7 * 24 * 3600_000;
const GAP = 20 * 3600_000;

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
const read = (k: string) => Number(store()?.getItem(k) ?? 0) || 0;
const write = (k: string, v: number) => {
  try {
    store()?.setItem(k, String(v));
  } catch {
    /* private mode: the sheet just shows again later */
  }
};

export default function InstallSheet() {
  const t = useTranslations("installSheet");
  const id = useId();
  const pathname = usePathname();
  const allPhones = useSetting("install_sheet_all_phones");
  const delay = useSetting("install_sheet_delay_seconds");
  const maxShows = useSetting("install_sheet_max_shows");
  const state = useInstallState();
  const [ctx, setCtx] = useState<InstallContext | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (state === "hidden" || pathname.startsWith("/admin")) return;
    const c = installContext(navigator.userAgent, { touchMac: navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1 });
    if (c.os === "other") return;
    const now = Date.now();
    if (fromAd(window.location.search, navigator.userAgent)) write(AD_KEY, now + WEEK);
    if (!allPhones && read(AD_KEY) < now) return;
    if (read(SHOWS_KEY) >= maxShows || now - read(LAST_KEY) < GAP) return;
    const timer = window.setTimeout(() => {
      write(SHOWS_KEY, read(SHOWS_KEY) + 1);
      write(LAST_KEY, Date.now());
      setCtx(c);
      setOpen(true);
    }, Math.max(0, delay) * 1000);
    return () => window.clearTimeout(timer);
  }, [state, pathname, allPhones, delay, maxShows]);

  const steps: InstallSteps = ctx ? installSteps(ctx, state === "ready") : "none";

  // Counted once it is on screen, with the steps it showed (Statistiques).
  useEffect(() => {
    if (open && ctx) trackEvent("install_shown", { via: "sheet", steps: installSteps(ctx, state === "ready"), app: ctx.app ?? "" });
    // The steps may change while it is open (Chrome's prompt arriving); one count per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || !ctx || steps === "none" || (state === "hidden" && !done)) return null;

  const close = () => {
    setOpen(false);
    trackEvent("install_click", { via: "sheet", action: "later", steps });
  };

  async function install() {
    trackEvent("install_click", { via: "sheet", action: "prompt", steps });
    const outcome = await promptInstall();
    if (outcome === "accepted") {
      setDone(true);
      trackEvent("install_done", { via: "sheet" });
      window.setTimeout(() => setOpen(false), 1800);
    }
  }

  async function copy() {
    trackEvent("install_click", { via: "sheet", action: "copy", steps });
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      /* nothing to copy with: the steps still say what to do */
    }
  }

  const list: { icon?: React.ReactNode; text: string }[] =
    steps === "ios-safari"
      ? [
          { icon: <Ellipsis className="size-4" />, text: t("iosSafari1") },
          { icon: <Share className="size-4" />, text: t("iosSafari2") },
          { icon: <SquarePlus className="size-4" />, text: t("iosSafari3") },
          { icon: <Check className="size-4" />, text: t("iosSafari4") },
        ]
      : steps === "ios-other"
        ? [
            { icon: <Share className="size-4" />, text: t("iosOther1") },
            { icon: <SquarePlus className="size-4" />, text: t("iosOther2") },
            { icon: <Check className="size-4" />, text: t("iosOther3") },
          ]
        : steps === "inapp-ios"
          ? [
              { icon: <Ellipsis className="size-4" />, text: t("inAppIos1") },
              { icon: <ExternalLink className="size-4" />, text: t("inAppIos2") },
              { icon: <SquarePlus className="size-4" />, text: t("inAppIos3") },
            ]
          : steps === "inapp-android"
            ? [{ icon: <EllipsisVertical className="size-4" />, text: t("inAppAndroid1") }]
            : steps === "android-menu"
              ? [
                  { icon: <EllipsisVertical className="size-4" />, text: t("androidMenu1") },
                  { icon: <SquarePlus className="size-4" />, text: t("androidMenu2") },
                ]
              : [];

  // On <body>, not inside the header: the header is its own stacking context, under which the
  // bottom bar and the consent card stayed on top of the sheet.
  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-end bg-black/45" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full rounded-t-[28px] bg-surface px-5 pb-[calc(20px+env(safe-area-inset-bottom))] pt-5 shadow-[0_-12px_40px_rgba(0,0,0,0.18)]"
      >
        <button
          type="button"
          onClick={close}
          aria-label={t("later")}
          className="tap-target absolute end-3 top-3 grid size-9 place-items-center rounded-full text-muted transition hover:bg-surface-2 hover:text-foreground"
        >
          <X className="size-5" />
        </button>

        <div className="flex items-center gap-3.5 pe-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" width={56} height={56} className="size-14 shrink-0 rounded-2xl shadow-[var(--shadow-card)] ring-1 ring-border" />
          <div className="min-w-0">
            <p id={`${id}-title`} className="text-[17px] font-extrabold leading-tight text-foreground">
              {done ? t("installed") : t("title")}
            </p>
            <p className="mt-0.5 text-[12.5px] text-muted">{t("subtitle")}</p>
          </div>
        </div>

        {!done && (
          <>
            <ul className="mt-4 space-y-1.5 text-[13px] text-foreground">
              {(["benefit1", "benefit2", "benefit3"] as const).map((k) => (
                <li key={k} className="flex items-center gap-2">
                  <Check className="size-4 shrink-0 text-[var(--tone-ok)]" />
                  {t(k)}
                </li>
              ))}
            </ul>

            {steps === "android-prompt" && (
              <button type="button" onClick={install} className="mazed-btn-luxe tap-target mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full text-[15px] text-[var(--background)]">
                <SquarePlus className="size-5" />
                {t("install")}
              </button>
            )}

            {steps === "inapp-android" && (
              <a
                href={chromeIntentUrl(window.location.href)}
                onClick={() => trackEvent("install_click", { via: "sheet", action: "open_chrome", steps })}
                className="mazed-btn-luxe tap-target mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full text-[15px] text-[var(--background)]"
              >
                <ExternalLink className="size-5" />
                {t("openChrome")}
              </a>
            )}

            {list.length > 0 && (
              <div className="mt-4 rounded-2xl bg-surface-2 p-3.5 ring-1 ring-border">
                <p className="text-[12px] font-extrabold text-foreground">{steps === "inapp-android" ? t("orByHand") : t("howTitle")}</p>
                <ol className="mt-2 space-y-2.5">
                  {list.map((s, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-[13px] leading-snug text-foreground">
                      <span className="mazed-tabular grid size-6 shrink-0 place-items-center rounded-full bg-foreground text-[11px] font-extrabold text-[var(--background)]">
                        {i + 1}
                      </span>
                      <span className="flex min-w-0 flex-1 items-start gap-1.5">
                        <span>{s.text}</span>
                        {s.icon && <span className="mt-0.5 inline-grid size-6 shrink-0 place-items-center rounded-md bg-surface text-foreground ring-1 ring-border" aria-hidden>{s.icon}</span>}
                      </span>
                    </li>
                  ))}
                </ol>
                {steps === "ios-safari" && <p className="mt-2.5 text-[11.5px] leading-snug text-muted">{t("iosOlder")}</p>}
              </div>
            )}

            {steps === "inapp-ios" && (
              <button type="button" onClick={copy} className="mazed-btn-quiet tap-target mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full text-[14px]">
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? t("copied") : t("copyLink")}
              </button>
            )}

            <button type="button" onClick={close} className="tap-target mt-2 w-full py-2.5 text-[13px] font-bold text-muted hover:text-foreground">
              {t("later")}
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
