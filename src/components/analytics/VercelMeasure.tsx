"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { isPrivateLinkPath } from "@/lib/analytics/ga";

/**
 * Vercel's page-view and speed measurements, minus an owner's private link.
 *
 * `/gerer/<token>` carries a 365-day bearer credential in its address, and both
 * tools send the address of the page. The functions have to be passed from a
 * client component, which is why the two are here and not in the layout.
 */
function dropPrivateLinks<E extends { url?: string }>(event: E): E | null {
  try {
    if (event.url && isPrivateLinkPath(new URL(event.url, "https://x.invalid").pathname)) return null;
  } catch {
    /* an address that does not parse is sent as it is */
  }
  return event;
}

export function VercelMeasure() {
  return (
    <>
      <Analytics beforeSend={dropPrivateLinks} />
      <SpeedInsights beforeSend={dropPrivateLinks} />
    </>
  );
}
