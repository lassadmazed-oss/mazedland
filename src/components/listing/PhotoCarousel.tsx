"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { IMAGE_BLUR_MAP } from "@/lib/imageBlurMap";
import { isRtl } from "@/lib/i18n";

type Photo = {
  id: string;
  storage_path: string;
};

// Auto-advance cadence — a calm gallery pace (the old 1.5s read as a
// frantic flicker). 4.5s gives each photo time to register.
const AUTO_INTERVAL_MS = 4500;
// Pause auto-advance for this long after a manual prev/next/swipe/thumb tap.
const USER_NAV_PAUSE_MS = 6000;
// Swipe distance (px) that counts as a slide gesture.
const SWIPE_THRESHOLD = 40;

/**
 * The annonce's photos, one at a time.
 *
 * Moved here from `components/auction/` when the auction product was deleted.
 * Nothing about a photo gallery is auction-specific — the lot page was simply
 * the only screen that had one. `/annonces/[id]` is that screen now.
 *
 *   - Real horizontal SLIDE (translateX track), not a cross-fade.
 *   - Seamless infinite loop: the first photo is cloned at the end, and we
 *     snap back to it without animation once the slide lands on the clone.
 *   - Swipe left/right on touch, arrows on desktop, clickable thumbnail strip.
 *   - `autoplay` advances every 4.5s; the annonce page passes false (2026-10-31):
 *     a buyer inspecting a photo must not have it taken away. The option stays
 *     for a showcase that wants it.
 *   - `counter` prints « 3 / 12 » on the photo, the way every property app
 *     does, so the reader knows how much there is to see.
 *   - `variant="modal"` is the full-screen gallery the desktop mosaic opens.
 *
 * The server-rendered overlay (chips, title) is passed in via `children` so
 * crawlers see it without waiting for hydration.
 */
export function PhotoCarousel({
  photos,
  alt,
  children,
  autoplay = true,
  counter = false,
  startIndex = 0,
  variant = "page",
}: {
  photos: Photo[];
  alt: string;
  children?: React.ReactNode;
  autoplay?: boolean;
  counter?: boolean;
  startIndex?: number;
  variant?: "page" | "modal";
}) {
  const t = useTranslations();
  // Right-to-left, the flex track lays the slides out leftwards from the right
  // edge: the next photo is to the LEFT, so the track moves right to reach it,
  // and the finger swipes right to bring it in.
  const rtl = isRtl(useLocale());
  const count = photos.length;
  const loop = count > 1;
  const modal = variant === "modal";
  // Clone the first photo at the tail for a seamless wrap.
  const slides = loop ? [...photos, photos[0]] : photos;

  const [index, setIndex] = useState(() => Math.min(Math.max(0, startIndex), Math.max(0, count - 1)));
  const [anim, setAnim] = useState(true);
  const pauseUntil = useRef(0);
  const touchX = useRef<number | null>(null);

  const activeDot = count > 0 ? index % count : 0;

  // Auto-advance.
  useEffect(() => {
    if (!loop || !autoplay) return;
    const id = window.setInterval(() => {
      if (Date.now() < pauseUntil.current) return;
      setAnim(true);
      setIndex((i) => i + 1);
    }, AUTO_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [loop, autoplay]);

  // Re-enable the transition the frame after a no-anim snap-back.
  useEffect(() => {
    if (anim) return;
    const id = requestAnimationFrame(() => setAnim(true));
    return () => cancelAnimationFrame(id);
  }, [anim]);

  function onTransitionEnd() {
    // Landed on the cloned first photo → jump back to the real first
    // without animating, so the loop is invisible.
    if (index >= count) {
      setAnim(false);
      setIndex(0);
    }
  }

  function go(delta: number) {
    if (!loop) return;
    pauseUntil.current = Date.now() + USER_NAV_PAUSE_MS;
    setAnim(true);
    setIndex((i) => {
      const n = i + delta;
      if (n < 0) return count - 1;
      if (n > count) return 0;
      return n;
    });
  }

  function jumpTo(i: number) {
     
    pauseUntil.current = Date.now() + USER_NAV_PAUSE_MS;
    setAnim(true);
    setIndex(i);
  }

  // Keyboard, in the modal: the arrows step through the photos.
  useEffect(() => {
    if (!modal || !loop) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") go(rtl ? -1 : 1);
      else if (e.key === "ArrowLeft") go(rtl ? 1 : -1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `go` only reads refs and setters
  }, [modal, loop, rtl]);

  const arrow =
    "absolute top-1/2 z-20 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/92 text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.2)] backdrop-blur-md transition hover:bg-white active:scale-95";

  return (
    <div>
      <div className="relative">
        {/* 4:3 on a phone too, and never more than half the screen: a portrait
            photo pushed the title, the place and the price below the fold
            (2026-10-27 audit). The modal has the whole screen. */}
        <div
          className={`relative w-full overflow-hidden ${
            modal ? "aspect-[4/3] max-h-[78svh] bg-black" : "aspect-[4/3] max-h-[50svh] bg-surface-2"
          }`}
          style={{ touchAction: "pan-y" }}
          onTouchStart={(e) => {
            touchX.current = e.touches[0].clientX;
            pauseUntil.current = Date.now() + USER_NAV_PAUSE_MS;
          }}
          onTouchEnd={(e) => {
            if (touchX.current == null) return;
            const dx = e.changedTouches[0].clientX - touchX.current;
            touchX.current = null;
            if (Math.abs(dx) > SWIPE_THRESHOLD) go((rtl ? dx > 0 : dx < 0) ? 1 : -1);
          }}
        >
          {count > 0 ? (
            <div
              className="flex h-full w-full"
              style={{
                transform: `translateX(${rtl ? "" : "-"}${index * 100}%)`,
                transition: anim ? "transform 500ms ease-out" : "none",
              }}
              onTransitionEnd={onTransitionEnd}
            >
              {slides.map((p, i) => {
                const src = propertyPhotoUrl(p.storage_path);
                const blur = IMAGE_BLUR_MAP[p.storage_path];
                return (
                  <div
                    key={`${p.id}-${i}`}
                    className="relative h-full w-full shrink-0"
                  >
                    <Image
                      src={src}
                      alt={alt}
                      fill
                      loading={i === 0 ? "eager" : "lazy"}
                      fetchPriority={i === 0 ? "high" : undefined}
                      sizes={modal ? "100vw" : "(min-width: 1024px) 1100px, 100vw"}
                      placeholder={blur ? "blur" : "empty"}
                      blurDataURL={blur}
                      className={modal ? "object-contain" : "object-cover"}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-7xl text-foreground/15">
              🏛️
            </div>
          )}
        </div>

        {/* Overlay content — badges + title, server-rendered. */}
        {children}

        {/* « 3 / 12 » */}
        {counter && count > 1 && (
          <span className="mazed-chip-photo mazed-chip-photo-ink pointer-events-none absolute end-3 top-3 z-20 h-7 px-2.5 text-[12px]">
            <span className="mazed-tabular" dir="ltr">
              {t("listing.gallery.counter", { n: activeDot + 1, total: count })}
            </span>
          </span>
        )}

        {/* Arrows + dots — only when there's more than one photo. */}
        {loop && (
          <>
            <button
              type="button"
              aria-label={t("gallery.prev")}
              onClick={() => go(-1)}
              className={`${arrow} ltr:left-3 rtl:right-3`}
            >
              <ChevronLeft className="h-5 w-5 ltr:block rtl:hidden" strokeWidth={2.5} />
              <ChevronRight className="h-5 w-5 ltr:hidden rtl:block" strokeWidth={2.5} />
            </button>
            <button
              type="button"
              aria-label={t("gallery.next")}
              onClick={() => go(1)}
              className={`${arrow} ltr:right-3 rtl:left-3`}
            >
              <ChevronRight className="h-5 w-5 ltr:block rtl:hidden" strokeWidth={2.5} />
              <ChevronLeft className="h-5 w-5 ltr:hidden rtl:block" strokeWidth={2.5} />
            </button>

            {/* Dots, under the photo on the page; the modal has the thumbnails. */}
            {!modal && (
              <div className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1.5 backdrop-blur-md ring-1 ring-white/15">
                {photos.slice(0, 12).map((p, i) => (
                  <button
                    key={p.id}
                    type="button"
                    aria-label={t("gallery.goToPhoto", { n: i + 1 })}
                    onClick={() => jumpTo(i)}
                    className={`block h-1.5 rounded-full transition-all ${
                      i === activeDot
                        ? "w-5 bg-white"
                        : "w-1.5 bg-white/55 hover:bg-white/85"
                    }`}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Clickable thumbnail strip — jump straight to a photo. */}
      {loop && (
        <div className={`hide-scrollbar flex gap-2 overflow-x-auto ${modal ? "justify-center px-4 pt-3" : "px-4 pt-3 lg:px-0"}`}>
          {photos.map((p, i) => {
            const src = propertyPhotoUrl(p.storage_path);
            return (
              <button
                key={p.id}
                type="button"
                aria-label={t("gallery.goToPhoto", { n: i + 1 })}
                aria-current={i === activeDot ? "true" : undefined}
                onClick={() => jumpTo(i)}
                className={`relative aspect-[4/3] w-[72px] shrink-0 overflow-hidden rounded-lg transition ${
                  i === activeDot
                    ? "ring-2 ring-[var(--foreground)] ring-offset-2 ring-offset-[var(--background)]"
                    : "opacity-60 hover:opacity-100"
                } ${modal ? "ring-offset-black" : ""}`}
              >
                <Image
                  src={src}
                  alt=""
                  fill
                  sizes="72px"
                  className="object-cover"
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
