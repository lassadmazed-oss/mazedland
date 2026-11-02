"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useSetting } from "@/components/settings/SettingsProvider";
import { isConsolePath } from "@/lib/analytics/ga";
import { configureFirstParty, isUuid, resetImpressions, trackEvent, type EventName } from "@/lib/analytics/events";
import { EVENT_NAMES } from "@/lib/analytics/events";
import { useAnalytics } from "./GoogleAnalytics";

const KNOWN = new Set<string>(EVENT_NAMES);

/**
 * The site's own count, wired (src/lib/analytics/events.ts): tells the queue
 * what the settings and the visitor say, counts a page view on every
 * navigation, and listens for taps on anything that carries `data-track`
 * (a server-rendered link can be counted without becoming a client
 * component: `data-track="agence_contact" data-track-via="call"
 * data-track-shop="<id>"`). Renders nothing; never on the console.
 */
export function FirstPartyEvents() {
  const pathname = usePathname();
  const enabled = useSetting("analytics_events_enabled");
  const waitForConsent = useSetting("analytics_events_consent");
  const { askConsent, consent } = useAnalytics();

  useEffect(() => {
    configureFirstParty({ enabled, waitForConsent, askConsent, consent });
  }, [enabled, waitForConsent, askConsent, consent]);

  useEffect(() => {
    if (!enabled || isConsolePath(pathname)) return;
    // A new page: what it shows is shown anew, even an annonce seen a page ago.
    resetImpressions();
    trackEvent("page_view", {}, {}, { ga: false });
  }, [pathname, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest<HTMLElement>("[data-track]");
      if (!el) return;
      const name = el.dataset.track ?? "";
      if (!KNOWN.has(name)) return;
      const params: Record<string, string> = {};
      for (const [k, v] of Object.entries(el.dataset)) {
        if (k.startsWith("track") && k.length > 5 && k !== "trackListing" && k !== "trackShop" && v) {
          params[k.slice(5).toLowerCase()] = v;
        }
      }
      trackEvent(name as EventName, params, {
        listing: isUuid(el.dataset.trackListing) ? el.dataset.trackListing : undefined,
        shop: isUuid(el.dataset.trackShop) ? el.dataset.trackShop : undefined,
      });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [enabled]);

  return null;
}
