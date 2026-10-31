"use client";

import { useEffect } from "react";
import { track, type EventParams } from "@/lib/analytics/ga";

/**
 * Sends one GA event when a server-rendered page shows — again only when what
 * it says changes (a new search on the same page). Renders nothing.
 */
export function TrackEvent({ name, params }: { name: string; params?: EventParams }) {
  const key = JSON.stringify(params ?? {});
  useEffect(() => {
    track(name, JSON.parse(key) as EventParams);
  }, [name, key]);
  return null;
}
