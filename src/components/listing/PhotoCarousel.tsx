"use client";

import { useEffect, useRef, useState } from "react";
import { SafeImage } from "@/components/media/SafeImage";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { IMAGE_BLUR_MAP } from "@/lib/imageBlurMap";
import { isRtl } from "@/lib/i18n";
import { HiddenAt } from "@/components/ui/HiddenAt";
import { trackEvent } from "@/lib/analytics/events";
import { useSetting } from "@/components/settings/SettingsProvider";
import type { Size } from "@/lib/zoom";
import { usePhotoZoom } from "./usePhotoZoom";

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
 *   - `variant="modal"` is the full-screen gallery (GalleryModal), with the
 *     zoom of usePhotoZoom when the console has it on (`gallery_zoom`).
 *   - `onOpen` makes a tap on the photo open that gallery (PhonePhotos).
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
  hiddenAt,
  listingId,
  onOpen,
}: {
  photos: Photo[];
  alt: string;
  children?: React.ReactNode;
  autoplay?: boolean;
  counter?: boolean;
  startIndex?: number;
  variant?: "page" | "modal";
  /** The media query at which CSS hides this carousel: its eager first photo is not downloaded there. */
  hiddenAt?: string;
  /** The annonce, for the count of photos looked at (Statistiques). */
  listingId?: string;
  /** A tap on the photo opens the full-screen gallery at that photo. */
  onOpen?: (index: number) => void;
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

  // A photo a reader chose to look at, once each per annonce (not the autoplay).
  // The index through a ref: the keyboard handler below keeps the first `go`.
  const looked = useRef(new Set<number>());
  const indexRef = useRef(index);
  indexRef.current = index;

  // Zoom, in the full-screen gallery only. The photos' own sizes, as each
  // loads, say where a zoomed photo's edges are.
  const zoomSetting = useSetting("gallery_zoom");
  const zoomMax = useSetting("gallery_zoom_max");
  const zoomOn = modal && zoomSetting && count > 0;
  const frameRef = useRef<HTMLDivElement>(null);
  const naturals = useRef(new Map<number, Size>());
  const zoom = usePhotoZoom({
    enabled: zoomOn,
    max: zoomMax,
    frameRef,
    natural: () => naturals.current.get(indexRef.current % Math.max(1, count)) ?? null,
  });
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  // A swipe that changed photo is not also a tap that opens the gallery.
  const swiped = useRef(false);
  function lookedAt(i: number) {
    if (!listingId || count < 2) return;
    const at = ((i % count) + count) % count;
    if (looked.current.has(at)) return;
    looked.current.add(at);
    trackEvent("gallery_photo", { index: at, of: count, where: modal ? "modal" : "page" }, { listing: listingId });
  }

  function go(delta: number) {
    if (!loop) return;
    pauseUntil.current = Date.now() + USER_NAV_PAUSE_MS;
    zoomRef.current.reset();
    setAnim(true);
    lookedAt(indexRef.current + delta);
    setIndex((i) => {
      const n = i + delta;
      if (n < 0) return count - 1;
      if (n > count) return 0;
      return n;
    });
  }

  function jumpTo(i: number) {
    pauseUntil.current = Date.now() + USER_NAV_PAUSE_MS;
    zoomRef.current.reset();
    setAnim(true);
    lookedAt(i);
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

  // « + », « − » and « 0 » zoom in, out and back, in the full-screen gallery.
  useEffect(() => {
    if (!zoomOn) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "+" || e.key === "=") zoomRef.current.zoomIn();
      else if (e.key === "-") zoomRef.current.zoomOut();
      else if (e.key === "0") zoomRef.current.reset();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomOn]);

  const arrow =
    "absolute top-1/2 z-20 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/92 text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.2)] backdrop-blur-md transition hover:bg-white active:scale-95";

  return (
    <div>
      <div className="relative">
        {/* 4:3 on a phone too, and never more than half the screen: a portrait
            photo pushed the title, the place and the price below the fold
            (2026-10-27 audit). The modal has the whole screen: on an upright
            phone a taller frame than 4:3, so a photo can be zoomed into. */}
        <div
          ref={frameRef}
          className={`relative w-full overflow-hidden ${
            modal
              ? "h-[64svh] bg-black sm:h-auto sm:aspect-[4/3] sm:max-h-[78svh]"
              : "aspect-[4/3] max-h-[50svh] bg-surface-2"
          } ${onOpen ? "cursor-zoom-in" : ""}`}
          style={{
            // The gallery's own pinch, not the browser's zoom of the page.
            touchAction: zoomOn ? "none" : "pan-y",
            cursor: zoomOn ? (zoom.zoom.scale > 1 ? (zoom.gesturing ? "grabbing" : "grab") : "zoom-in") : undefined,
          }}
          {...zoom.handlers}
          onTouchStart={(e) => {
            touchX.current = e.touches[0].clientX;
            pauseUntil.current = Date.now() + USER_NAV_PAUSE_MS;
          }}
          onTouchEnd={(e) => {
            if (touchX.current == null) return;
            const dx = e.changedTouches[0].clientX - touchX.current;
            touchX.current = null;
            // A pinch, a zoomed photo moved, a double tap: not a swipe.
            if (Math.abs(dx) > SWIPE_THRESHOLD && !zoom.blocksSwipe()) {
              swiped.current = true;
              go((rtl ? dx > 0 : dx < 0) ? 1 : -1);
            }
          }}
          {...(onOpen
            ? {
                role: "button",
                tabIndex: 0,
                "aria-label": t("listing.gallery.openFull"),
                onClick: () => {
                  if (swiped.current) {
                    swiped.current = false;
                    return;
                  }
                  onOpen(activeDot);
                },
                onKeyDown: (e: React.KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen(activeDot);
                  }
                },
              }
            : {})}
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
                    {(() => {
                      const zoomed = zoomOn && i === index && zoom.zoom.scale > 1;
                      const img = (
                        <SafeImage
                          src={src}
                          alt={alt}
                          fill
                          loading={i === 0 ? "eager" : "lazy"}
                          fetchPriority={i === 0 ? "high" : undefined}
                          // Zoomed in, the largest size there is: the photo as
                          // uploaded (1600 px on its long side) rather than a
                          // screen-wide copy blown up.
                          sizes={zoomed ? "1920px" : modal ? "100vw" : "(min-width: 1024px) 1100px, 100vw"}
                          placeholder={blur ? "blur" : "empty"}
                          blurDataURL={blur}
                          className={`${modal ? "object-contain" : "object-cover"} ${zoomOn ? "select-none" : ""}`}
                          draggable={zoomOn ? false : undefined}
                          onLoad={
                            zoomOn
                              ? (e) => naturals.current.set(i % count, { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
                              : undefined
                          }
                        />
                      );
                      // The first photo loads eagerly, and display:none does not
                      // stop that: where CSS hides this carousel, an empty GIF
                      // takes its place (see HiddenAt).
                      const shown =
                        i === 0 && hiddenAt ? (
                          <HiddenAt media={hiddenAt} className="absolute inset-0">
                            {img}
                          </HiddenAt>
                        ) : (
                          img
                        );
                      return zoomOn ? (
                        <div
                          className="absolute inset-0"
                          style={
                            i === index
                              ? {
                                  transform: `translate(${zoom.zoom.x}px, ${zoom.zoom.y}px) scale(${zoom.zoom.scale})`,
                                  transition: zoom.gesturing ? "none" : "transform 160ms ease-out",
                                }
                              : undefined
                          }
                        >
                          {shown}
                        </div>
                      ) : (
                        shown
                      );
                    })()}
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

        {/* « − » and « + », for a mouse without a wheel and whoever does not know the pinch. */}
        {zoomOn && (
          <div className="absolute bottom-3 start-3 z-20 inline-flex gap-1.5">
            <button
              type="button"
              aria-label={t("listing.gallery.zoomOut")}
              onClick={() => zoom.zoomOut()}
              disabled={zoom.zoom.scale <= 1}
              className="inline-grid size-10 place-items-center rounded-full bg-white/92 text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.2)] transition hover:bg-white active:scale-95 disabled:opacity-40"
            >
              <ZoomOut className="size-5" strokeWidth={2.2} />
            </button>
            <button
              type="button"
              aria-label={t("listing.gallery.zoomIn")}
              onClick={() => zoom.zoomIn()}
              disabled={zoom.zoom.scale >= zoomMax}
              className="inline-grid size-10 place-items-center rounded-full bg-white/92 text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.2)] transition hover:bg-white active:scale-95 disabled:opacity-40"
            >
              <ZoomIn className="size-5" strokeWidth={2.2} />
            </button>
          </div>
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
                <SafeImage
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

      {/* How to zoom: fingers on a touch screen, the wheel with a mouse. */}
      {zoomOn && (
        <p className="px-4 pt-3 text-center text-[12px] text-white/60">
          <span className="pointer-coarse:hidden">{t("listing.gallery.zoomHintMouse")}</span>
          <span className="hidden pointer-coarse:inline">{t("listing.gallery.zoomHintTouch")}</span>
        </p>
      )}
    </div>
  );
}
