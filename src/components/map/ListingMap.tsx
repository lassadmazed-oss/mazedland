"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { MapPin, Navigation } from "lucide-react";
import type * as MapLibre from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { circleRing, directionsUrl, type LatLng } from "@/lib/geo/location";
import { MAP_STYLE, loadMapLibre } from "./maplibre";

/**
 * « Où se trouve le bien » on the annonce page (0212). `point` is the public
 * one (listings.lat/lng): the pin when the seller chose « exacte », with the
 * way there in Google Maps; otherwise a circle of `radiusM` around a point
 * near the house, never the house.
 *
 * The map loads when it comes near the screen, so a visitor who reads the
 * photos and the price pays nothing for it; on a phone it moves with two
 * fingers, so scrolling the page past it still scrolls the page.
 */
export function ListingMap({ point, exact, radiusM }: { point: LatLng; exact: boolean; radiusM: number }) {
  const t = useTranslations("listingMap");
  const { lat, lng } = point;
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setNear(true);
        io.disconnect();
      }
    }, { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!near || !box.current) return;
    let map: MapLibre.Map | null = null;
    let gone = false;
    void loadMapLibre().then((m) => {
      if (gone || !box.current) return;
      map = new m.Map({
        container: box.current,
        style: MAP_STYLE,
        center: [lng, lat],
        zoom: exact ? 15.5 : radiusM > 900 ? 13 : 14,
        attributionControl: { compact: true },
        cooperativeGestures: true,
      });
      map.addControl(new m.NavigationControl({ showCompass: false }), "top-right");
      if (exact) {
        new m.Marker({ color: "#18181b" }).setLngLat([lng, lat]).addTo(map);
      } else {
        const created = map;
        created.on("load", () => {
          created.addSource("area", {
            type: "geojson",
            data: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [circleRing({ lat, lng }, radiusM)] } },
          });
          created.addLayer({ id: "area-fill", type: "fill", source: "area", paint: { "fill-color": "#18181b", "fill-opacity": 0.12 } });
          created.addLayer({ id: "area-line", type: "line", source: "area", paint: { "line-color": "#18181b", "line-width": 2, "line-opacity": 0.6 } });
        });
      }
      map.once("load", () => setReady(true));
    });
    return () => {
      gone = true;
      map?.remove();
    };
  }, [near, lat, lng, exact, radiusM]);

  return (
    <div>
      <div className="relative h-[260px] overflow-hidden rounded-[var(--radius-2xl)] bg-surface-2 ring-1 ring-border sm:h-[320px]">
        <div ref={box} className="h-full w-full" role="region" aria-label={t("mapLabel")} />
        {!ready && <MapPin aria-hidden className="absolute start-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 text-subtle" />}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-muted">{exact ? t("exactNote") : t("approxNote", { radius: radiusM })}</p>
        {exact && (
          <a
            href={directionsUrl(point)}
            target="_blank"
            rel="noopener noreferrer"
            className="mazed-btn-quiet tap-target inline-flex h-10 items-center gap-2 rounded-full px-4 text-[13px]"
          >
            <Navigation className="size-4" /> {t("directions")}
          </a>
        )}
      </div>
    </div>
  );
}
