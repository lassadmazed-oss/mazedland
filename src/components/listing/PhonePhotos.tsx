"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { trackEvent } from "@/lib/analytics/events";
import { PhotoCarousel } from "./PhotoCarousel";
import { GalleryModal } from "./GalleryModal";

type Photo = { id: string; storage_path: string };

/**
 * The annonce's photos on a phone (the page shows GalleryMosaic from lg):
 * the swipe carousel, and a tap on the photo opens the full-screen gallery
 * at that photo, whole and zoomable (the owner, 2026-11-05). Opening it is
 * counted like the mosaic's.
 */
export function PhonePhotos({
  photos,
  alt,
  hiddenAt,
  listingId,
}: {
  photos: Photo[];
  alt: string;
  hiddenAt?: string;
  listingId?: string;
}) {
  const t = useTranslations("listing.gallery");
  const [openAt, setOpenAt] = useState<number | null>(null);

  return (
    <>
      <PhotoCarousel
        photos={photos}
        alt={alt}
        autoplay={false}
        counter
        hiddenAt={hiddenAt}
        listingId={listingId}
        onOpen={(i) => {
          trackEvent("gallery_open", { index: i, of: photos.length }, { listing: listingId });
          setOpenAt(i);
        }}
      />
      {openAt !== null && (
        <GalleryModal photos={photos} alt={alt} startIndex={openAt} onClose={() => setOpenAt(null)} closeLabel={t("close")} listingId={listingId} />
      )}
    </>
  );
}
