"use client";

import { useEffect, useRef } from "react";
import { trackImpressions } from "@/lib/analytics/events";

/**
 * Counts the annonces of a rail or a grid as shown, once the element it sits
 * in is on screen. Placed as the last child of the list's container; renders
 * an empty, hidden span and watches its parent. A list hidden by CSS (the
 * other layout of the home page) never comes on screen, so it never counts.
 */
export function Impressions({ ids, surface }: { ids: readonly string[]; surface: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const key = ids.join(",");

  useEffect(() => {
    const target = ref.current?.parentElement;
    if (!target || ids.length === 0) return;
    if (typeof IntersectionObserver === "undefined") {
      trackImpressions(ids, surface);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        trackImpressions(ids, surface);
        io.disconnect();
      },
      { threshold: 0.1 },
    );
    io.observe(target);
    return () => io.disconnect();
    // The ids as a string: a new list on the same surface counts again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, surface]);

  return <span ref={ref} hidden aria-hidden />;
}
