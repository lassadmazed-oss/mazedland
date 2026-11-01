"use client";

import { useTranslations } from "next-intl";
import { BarChart3 } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { writeConsent, type Consent } from "@/lib/analytics/ga";
import { trackEvent } from "@/lib/analytics/events";
import { useAnalytics } from "./GoogleAnalytics";

/** The answer, kept, and counted (a no reaches Google never, the site's count only when it counts everyone). */
function answer(v: Consent) {
  writeConsent(v);
  trackEvent("consent", { answer: v });
}

/**
 * « Accepter / Refuser » for Google Analytics, when an admin asked for it
 * (analytics_ask_consent) and the visitor never answered. A card floating
 * above the bottom bar, not a wall and not a strip pushing the page down: the
 * site works the same either way, and Google loads only after « Accepter ».
 * The answer stays in this browser; the privacy page lets them change it.
 */
export function AnalyticsConsentBar() {
  const t = useTranslations("analyticsConsent");
  const { active, askConsent, consent } = useAnalytics();
  if (!active || !askConsent || consent !== null) return null;

  return (
    <div
      role="region"
      aria-label={t("label")}
      className="fixed inset-x-3 z-50 mx-auto max-w-lg rounded-2xl bg-surface p-3.5 shadow-lg ring-1 ring-border lg:inset-x-auto lg:start-4"
      style={{ bottom: "calc(var(--mazed-bottombar-h) + env(safe-area-inset-bottom) + 12px)" }}
    >
      <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-foreground">
        <BarChart3 className="mt-0.5 size-4 shrink-0 text-gold" />
        <span>
          {t.rich("body", {
            privacy: (chunks) => <Link href={"/privacy" as never} className="font-bold text-gold hover:underline">{chunks}</Link>,
          })}
        </span>
      </p>
      <div className="mt-2.5 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => answer("denied")}
          className="tap-target inline-flex items-center justify-center rounded-full border border-border px-4 py-1.5 text-[12.5px] font-bold text-foreground transition hover:bg-surface-2"
        >
          {t("decline")}
        </button>
        <button
          type="button"
          onClick={() => answer("granted")}
          className="mazed-btn-luxe tap-target inline-flex items-center justify-center px-4 py-1.5 text-[12.5px]"
        >
          {t("accept")}
        </button>
      </div>
    </div>
  );
}

/**
 * The visitor's answer on the privacy page, and the button that changes it —
 * also a way to say no when nobody is asked (analytics_ask_consent off).
 * Nothing while Analytics is off.
 */
export function AnalyticsChoice() {
  const t = useTranslations("analyticsConsent");
  const { active, askConsent, consent, allowed, known } = useAnalytics();
  if (!active || !known) return null;

  const status =
    consent === "granted"
      ? t("choiceGranted")
      : consent === "denied"
        ? t("choiceDenied")
        : askConsent
          ? t("choiceNone")
          : t("choiceDefault");

  return (
    <section id="analytics" className="mt-6 rounded-2xl bg-surface-2 p-4 ring-1 ring-border">
      <h2 className="text-[14px] font-bold text-foreground">{t("choiceTitle")}</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-foreground/80">{status}</p>
      <button
        type="button"
        onClick={() => answer(allowed ? "denied" : "granted")}
        className={
          allowed
            ? "tap-target mt-3 inline-flex items-center justify-center rounded-full border border-border bg-surface px-4 py-1.5 text-[12.5px] font-bold text-foreground transition hover:bg-surface-2"
            : "mazed-btn-luxe tap-target mt-3 inline-flex items-center justify-center px-4 py-1.5 text-[12.5px]"
        }
      >
        {allowed ? t("withdraw") : t("grant")}
      </button>
    </section>
  );
}
