"use client";

import Script from "next/script";
import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useSetting } from "@/components/settings/SettingsProvider";
import {
  currentConsent,
  dropPending,
  flushPending,
  gaAllowed,
  gaIdOrNull,
  gaInitScript,
  isConsolePath,
  subscribeConsent,
  type Consent,
} from "@/lib/analytics/ga";

/** Before hydration nobody's answer is known: neither the bar nor Google shows. */
export const UNKNOWN = "unknown";

/** Analytics as an admin set it (Réglages → Statistiques), and this visitor's answer. */
export function useAnalytics() {
  const enabled = useSetting("analytics_ga_enabled");
  const id = gaIdOrNull(useSetting("analytics_ga_id"));
  const askConsent = useSetting("analytics_ask_consent");
  const consent = useSyncExternalStore<Consent | null | typeof UNKNOWN>(subscribeConsent, currentConsent, () => UNKNOWN);
  const known = consent !== UNKNOWN;
  return {
    /** Switched on with a valid ID: there is something to accept or refuse. */
    active: enabled && !!id,
    id,
    askConsent,
    consent,
    allowed: known && gaAllowed({ enabled, id, askConsent, consent }),
    known,
  };
}

type Gtag = (...args: unknown[]) => void;
type GaWindow = Window & { gtag?: Gtag; __mazedGaOff?: boolean; __mazedGaSync?: () => void } & Record<string, unknown>;

/** GA's own cookies, gone when a visitor says no after accepting. */
function clearGaCookies() {
  const names = document.cookie
    .split(";")
    .map((c) => c.split("=")[0].trim())
    .filter((n) => n === "_ga" || n.startsWith("_ga_"));
  const host = window.location.hostname;
  const domains = ["", host, `.${host.split(".").slice(-2).join(".")}`];
  for (const n of names) {
    for (const d of domains) document.cookie = `${n}=; Max-Age=0; path=/${d ? `; domain=${d}` : ""}`;
  }
}

/**
 * Google Analytics 4 on the public site (Réglages → Statistiques), next to
 * the site's own page-view log, which it does not replace. Nothing from
 * Google loads while it is switched off, without a valid ID, on the console,
 * or — when the visitor is asked — before they said yes.
 */
export function GoogleAnalytics() {
  const pathname = usePathname();
  const { id, allowed, known } = useAnalytics();
  const onConsole = isConsolePath(pathname);

  useEffect(() => {
    if (!known) return;
    if (!allowed) dropPending();
    if (!id) return;
    const w = window as unknown as GaWindow;
    w.__mazedGaOff = !allowed;
    // Once loaded, the inline script owns Google's off switch — it keeps it on
    // while a page leaving the console reloads, which this must not undo.
    if (typeof w.__mazedGaSync === "function") w.__mazedGaSync();
    else w[`ga-disable-${id}`] = onConsole || !allowed;
    // Only once gtag.js is on the page: a no given after a yes, or a yes again.
    if (typeof w.gtag === "function") {
      w.gtag("consent", "update", { analytics_storage: allowed ? "granted" : "denied" });
      if (!allowed) clearGaCookies();
    }
  }, [known, allowed, id, onConsole]);

  if (!allowed || !id || onConsole) return null;
  return (
    <>
      <Script id="ga-init" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: gaInitScript(id) }} />
      {/* The queue waits for gtag.js, not the inline script: next/script calls
          an inline script's onReady before it puts it in the page. */}
      <Script id="ga-gtag" strategy="afterInteractive" src={`https://www.googletagmanager.com/gtag/js?id=${id}`} onReady={flushPending} />
    </>
  );
}
