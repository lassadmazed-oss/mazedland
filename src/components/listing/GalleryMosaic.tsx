"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Images, X } from "lucide-react";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { trackEvent } from "@/lib/analytics/events";
import { IMAGE_BLUR_MAP } from "@/lib/imageBlurMap";
import { HiddenAt, BELOW_LG } from "@/components/ui/HiddenAt";
import { PhotoCarousel } from "./PhotoCarousel";

type Photo = { id: string; storage_path: string };

/**
 * The desktop gallery of an annonce (2026-10-31): one big photo and up to
 * four small ones in a mosaic, the way Airbnb, Zillow and Rightmove open a
 * listing, with « Toutes les photos » and every tile opening the full-screen
 * gallery at that photo. Hidden under lg, where the page shows the swipe
 * carousel instead; the first photo is not downloaded there (HiddenAt).
 */
export function GalleryMosaic({ photos, alt, listingId }: { photos: Photo[]; alt: string; listingId?: string }) {
  const t = useTranslations("listing.gallery");
  const tg = useTranslations("gallery");
  const [openAt, setOpenAtState] = useState<number | null>(null);
  // Opening the full-screen gallery is counted (which photo it started on).
  const setOpenAt = (i: number | null) => {
    if (i !== null) trackEvent("gallery_open", { index: i, of: photos.length }, { listing: listingId });
    setOpenAtState(i);
  };
  const n = photos.length;
  if (n === 0) return null;

  // How many tiles, and how the big one spans.
  const cols = n === 1 ? "grid-cols-1" : n === 2 ? "grid-cols-2" : n <= 4 ? "grid-cols-3" : "grid-cols-4";
  const small = n === 1 ? [] : n === 2 ? photos.slice(1, 2) : n <= 4 ? photos.slice(1, 3) : photos.slice(1, 5);
  const bigSpan = n === 1 ? "" : n === 2 ? "row-span-2" : "col-span-2 row-span-2";

  return (
    <div className="hidden lg:block">
      <div className={`relative grid h-[480px] ${cols} grid-rows-2 gap-2 overflow-hidden rounded-[var(--radius-3xl)] bg-surface-2`}>
        <Tile photo={photos[0]} alt={alt} label={tg("goToPhoto", { n: 1 })} className={bigSpan} first onOpen={() => setOpenAt(0)} sizes="760px" />
        {small.map((p, i) => (
          <Tile
            key={p.id}
            photo={p}
            alt=""
            label={tg("goToPhoto", { n: i + 2 })}
            className={n === 2 ? "row-span-2" : ""}
            onOpen={() => setOpenAt(i + 1)}
            sizes="380px"
          />
        ))}
        {n > 1 && (
          <button
            type="button"
            onClick={() => setOpenAt(0)}
            className="absolute bottom-4 end-4 z-10 inline-flex h-10 items-center gap-2 rounded-full bg-white/95 px-4 text-[13px] font-bold text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.2)] backdrop-blur transition hover:bg-white active:scale-[0.98]"
          >
            <Images className="size-4" strokeWidth={2.2} aria-hidden />
            {t("all")} <span className="mazed-tabular text-muted">({n})</span>
          </button>
        )}
      </div>

      {openAt !== null && (
        <GalleryModal photos={photos} alt={alt} startIndex={openAt} onClose={() => setOpenAt(null)} closeLabel={t("close")} listingId={listingId} />
      )}
    </div>
  );
}

function Tile({
  photo,
  alt,
  label,
  className,
  first = false,
  onOpen,
  sizes,
}: {
  photo: Photo;
  alt: string;
  /** What the button does — « Aller à la photo 3 » — since the small tiles' photos carry no alt. */
  label: string;
  className: string;
  first?: boolean;
  onOpen: () => void;
  sizes: string;
}) {
  const src = propertyPhotoUrl(photo.storage_path);
  const blur = IMAGE_BLUR_MAP[photo.storage_path];
  const img = (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      loading={first ? "eager" : "lazy"}
      fetchPriority={first ? "high" : undefined}
      placeholder={blur ? "blur" : "empty"}
      blurDataURL={blur}
      className="object-cover transition-transform duration-700 group-hover:scale-[1.03]"
    />
  );
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      className={`group relative block min-h-0 overflow-hidden bg-surface-2 ${className}`}
    >
      {first ? (
        <HiddenAt media={BELOW_LG} className="absolute inset-0">
          {img}
        </HiddenAt>
      ) : (
        img
      )}
    </button>
  );
}

/** The full-screen gallery: the carousel on black, Escape or × to leave. */
function GalleryModal({
  photos,
  alt,
  startIndex,
  onClose,
  closeLabel,
  listingId,
}: {
  photos: Photo[];
  alt: string;
  startIndex: number;
  onClose: () => void;
  closeLabel: string;
  listingId?: string;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={alt} className="fixed inset-0 z-[120] flex flex-col justify-center bg-black/95 p-4">
      <button
        type="button"
        onClick={onClose}
        aria-label={closeLabel}
        className="absolute end-4 top-4 z-30 inline-grid size-11 place-items-center rounded-full bg-white/10 text-white ring-1 ring-white/20 transition hover:bg-white/20"
      >
        <X className="size-5" strokeWidth={2.4} />
      </button>
      <div className="mx-auto w-full max-w-6xl">
        <PhotoCarousel photos={photos} alt={alt} autoplay={false} counter startIndex={startIndex} variant="modal" listingId={listingId} />
      </div>
    </div>,
    document.body,
  );
}
