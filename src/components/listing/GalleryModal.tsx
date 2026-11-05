"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { PhotoCarousel } from "./PhotoCarousel";

type Photo = { id: string; storage_path: string };

/**
 * The full-screen gallery: the carousel on black, Escape or × to leave. The
 * desktop mosaic opens it from a tile, the phone's carousel from a tap on
 * the photo (PhonePhotos); the zoom lives in the carousel's « modal » form.
 * Edge to edge on a phone, where every pixel of width is photo, and on solid
 * black: at 95 % the page's header and bottom bar showed through the photo.
 */
export function GalleryModal({
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
    <div role="dialog" aria-modal="true" aria-label={alt} className="fixed inset-0 z-[120] flex flex-col justify-center bg-black py-4 sm:p-4">
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
