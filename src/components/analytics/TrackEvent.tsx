"use client";

import { useEffect } from "react";
import { trackEvent, type EventName } from "@/lib/analytics/events";

type Params = Record<string, string | number | boolean | string[] | undefined>;

/**
 * Sends one event when a server-rendered page shows — again only when what
 * it says changes (a new search on the same page). Google and the site's own
 * count both get it; `listing` / `shop` name what it is about. Renders nothing.
 */
export function TrackEvent({
  name,
  params,
  listing,
  shop,
  firstParty = true,
}: {
  name: EventName;
  params?: Params;
  listing?: string | null;
  shop?: string | null;
  firstParty?: boolean;
}) {
  const key = JSON.stringify(params ?? {});
  useEffect(() => {
    trackEvent(name, JSON.parse(key) as Params, { listing, shop }, { firstParty });
  }, [name, key, listing, shop, firstParty]);
  return null;
}
