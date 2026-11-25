"use client";

import { useLayoutEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Where the page starts after a route change.
 *
 *   A new page (a link, a tab): at the top, instantly — the owner's ask,
 *     « every page load from the top » (the PullToRefresh wrapper once broke
 *     the built-in handling, and a smooth scroll felt sluggish).
 *   Back / forward (2026-11-25, the owner chose it): where the visitor was,
 *     like Facebook or Tayara — coming back from an annonce lands on the same
 *     card of the list, not at the top of it.
 *
 * Each address's position is kept in memory while the visitor scrolls. On
 * « back » the page may still be arriving (a skeleton first, then the list), so
 * the position is applied again for a moment until the page is tall enough,
 * and given up as soon as the visitor scrolls by hand.
 */

const positions = new Map<string, number>();
let currentKey = "";
let popped = 0;
const keyOf = () => window.location.pathname + window.location.search;

if (typeof window !== "undefined") {
  window.addEventListener(
    "scroll",
    () => {
      if (currentKey) positions.set(currentKey, window.scrollY);
    },
    { passive: true },
  );
  // A back / forward is a popstate just before the route changes; one not
  // followed by a route change (same page) is forgotten after a moment.
  window.addEventListener("popstate", () => {
    popped = Date.now();
  });
}

export function ScrollToTop() {
  const pathname = usePathname();

  // Layout effect: the key moves to the new address in the same commit as the
  // new page, before the browser reports the scroll the page change causes —
  // which would otherwise be written down as the old page's position.
  useLayoutEffect(() => {
    const key = keyOf();
    const isBack = Date.now() - popped < 1500;
    popped = 0;
    currentKey = key;

    const target = isBack ? (positions.get(key) ?? 0) : 0;
    window.scrollTo({ top: target, left: 0, behavior: "instant" });
    if (!isBack || target === 0) return;

    // The page may still be streaming in: apply the position again until it fits.
    let stopped = false;
    const stop = () => {
      stopped = true;
    };
    const started = Date.now();
    const again = () => {
      if (stopped || Date.now() - started > 2000) return;
      if (Math.abs(window.scrollY - target) > 2) window.scrollTo({ top: target, left: 0, behavior: "instant" });
      const fits = document.documentElement.scrollHeight - window.innerHeight >= target;
      if (!fits || Math.abs(window.scrollY - target) > 2) window.setTimeout(again, 60);
    };
    window.setTimeout(again, 60);
    window.addEventListener("wheel", stop, { passive: true, once: true });
    window.addEventListener("touchstart", stop, { passive: true, once: true });
    return () => {
      stopped = true;
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
    };
  }, [pathname]);

  return null;
}
