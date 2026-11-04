"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ImageOff, MapPin } from "lucide-react";
import type * as MapLibre from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Link } from "@/i18n/navigation";
import { TUNISIA_VIEW, type LatLng } from "@/lib/geo/location";
import { compactPrice, inBounds, type MapPoint } from "@/lib/geo/mapPoints";
import { formatTND, cn } from "@/lib/utils";
import { MAP_STYLE, loadMapLibre } from "./maplibre";

/**
 * « Carte » in the catalogue (?vue=carte, 0212 phase 2): the annonces of the
 * search as price bubbles, gathered into numbered circles when far apart, and
 * beside the map the ones in its frame — moving the map is searching there.
 * A bubble drawn dashed is an annonce without a pin, standing in its
 * délégation (MapPoint.zone).
 */

const INK = "#18181b";
const PAPER = "#ffffff";
/** Past this zoom no circle gathers bubbles: a street is close enough to read them one by one. */
const CLUSTER_MAX_ZOOM = 13;

/** A bubble, drawn once on a canvas and stretched around its price (icon-text-fit). */
function bubble(fill: string, stroke: string, dashed: boolean) {
  // The stretchable parts must have a size: a radius of half the height left
  // none (24 → 24) and MapLibre drew the price without its bubble.
  const s = 2;
  const w = 48 * s;
  const h = 32 * s;
  const r = 12 * s;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.beginPath();
  g.roundRect(s, s, w - 2 * s, h - 2 * s, r - s);
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = 1.5 * s;
  g.strokeStyle = stroke;
  if (dashed) g.setLineDash([4 * s, 3 * s]);
  g.stroke();
  return {
    image: g.getImageData(0, 0, w, h),
    options: { pixelRatio: s, stretchX: [[r, w - r]] as [number, number][], stretchY: [[r, h - r]] as [number, number][], content: [10 * s, 7 * s, w - 10 * s, h - 7 * s] as [number, number, number, number] },
  };
}

export function CatalogueMap({
  points,
  unplaced,
  start,
  locale,
}: {
  points: MapPoint[];
  /** Annonces of the search the map cannot place (no pin, no délégation). */
  unplaced: number;
  /** Where to open when the search names a governorate; otherwise around the points. */
  start: { center: LatLng; zoom: number } | null;
  locale: string;
}) {
  const t = useTranslations("catalogueMap");
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibre.Map | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState<MapPoint[]>(points);
  const [selected, setSelected] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const geojson = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: points.map((p) => ({
        type: "Feature" as const,
        properties: { id: p.id, label: compactPrice(p.price, locale), zone: p.zone },
        geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
      })),
    }),
    [points, locale],
  );

  useEffect(() => {
    if (!box.current) return;
    let gone = false;
    let created: MapLibre.Map | null = null;
    void loadMapLibre().then((m) => {
      if (gone || !box.current) return;
      created = new m.Map({
        container: box.current,
        style: MAP_STYLE,
        center: [(start?.center ?? TUNISIA_VIEW.center).lng, (start?.center ?? TUNISIA_VIEW.center).lat],
        zoom: start?.zoom ?? TUNISIA_VIEW.zoom,
        attributionControl: { compact: true },
      });
      const mp = created;
      map.current = mp;
      mp.addControl(new m.NavigationControl({ showCompass: false }), "top-right");

      mp.on("load", () => {
        for (const [name, fill, stroke, dashed] of [
          ["bubble", PAPER, INK, false],
          ["bubble-zone", PAPER, "#71717a", true],
          ["bubble-on", INK, INK, false],
        ] as const) {
          const b = bubble(fill, stroke, dashed);
          mp.addImage(name, b.image, b.options);
        }
        mp.addSource("annonces", { type: "geojson", data: geojson, cluster: true, clusterRadius: 48, clusterMaxZoom: CLUSTER_MAX_ZOOM });
        mp.addLayer({
          id: "clusters",
          type: "circle",
          source: "annonces",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": INK,
            "circle-radius": ["step", ["get", "point_count"], 16, 10, 20, 50, 26],
            "circle-stroke-color": PAPER,
            "circle-stroke-width": 2,
          },
        });
        mp.addLayer({
          id: "cluster-count",
          type: "symbol",
          source: "annonces",
          filter: ["has", "point_count"],
          layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Bold"], "text-size": 13, "text-allow-overlap": true },
          paint: { "text-color": PAPER },
        });
        mp.addLayer({
          id: "bubbles",
          type: "symbol",
          source: "annonces",
          filter: ["!", ["has", "point_count"]],
          layout: {
            "text-field": ["get", "label"],
            "text-font": ["Noto Sans Bold"],
            "text-size": 12.5,
            "icon-image": ["case", ["get", "zone"], "bubble-zone", "bubble"],
            "icon-text-fit": "both",
            "icon-allow-overlap": true,
            "text-allow-overlap": true,
            "symbol-sort-key": ["case", ["get", "zone"], 1, 2],
          },
          paint: { "text-color": INK },
        });

        mp.on("click", "clusters", async (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const src = mp.getSource("annonces") as MapLibre.GeoJSONSource;
          const zoom = await src.getClusterExpansionZoom(f.properties.cluster_id as number);
          mp.easeTo({ center: (f.geometry as unknown as { coordinates: [number, number] }).coordinates, zoom: Math.min(zoom, CLUSTER_MAX_ZOOM + 2) });
        });
        mp.on("click", "bubbles", (e) => {
          const id = e.features?.[0]?.properties.id as string | undefined;
          if (id) setSelected(id);
        });
        for (const layer of ["clusters", "bubbles"]) {
          mp.on("mouseenter", layer, () => (mp.getCanvas().style.cursor = "pointer"));
          mp.on("mouseleave", layer, () => (mp.getCanvas().style.cursor = ""));
        }

        // Open on the search's points, unless it named a governorate.
        if (!start && points.length > 0) {
          const lats = points.map((p) => p.lat);
          const lngs = points.map((p) => p.lng);
          mp.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 48, maxZoom: 13, duration: 0 });
        }
        setReady(true);
      });

      // The frame is the search: what is in it is listed.
      mp.on("moveend", () => {
        const b = mp.getBounds();
        setInView(inBounds(points, { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }));
      });
    });
    return () => {
      gone = true;
      created?.remove();
      map.current = null;
    };
    // The map is made once; a new search is a new page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The chosen bubble turns dark, and its card comes into view.
  useEffect(() => {
    const mp = map.current;
    if (!ready || !mp?.getLayer("bubbles")) return;
    mp.setLayoutProperty("bubbles", "icon-image", ["case", ["==", ["get", "id"], selected ?? ""], "bubble-on", ["get", "zone"], "bubble-zone", "bubble"]);
    mp.setPaintProperty("bubbles", "text-color", ["case", ["==", ["get", "id"], selected ?? ""], PAPER, INK]);
    if (selected) {
      for (const layout of ["strip", "row"]) document.getElementById(`map-${layout}-${selected}`)?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    }
  }, [selected, ready]);

  const price = (p: MapPoint) =>
    p.price == null
      ? t("onRequest")
      : t(p.deal === "rent" ? "perMonth" : "amount", { amount: formatTND(p.price, locale) });

  const card = (p: MapPoint, layout: "row" | "strip") => (
    <li key={p.id} id={`map-${layout}-${p.id}`} className={layout === "strip" ? "w-[260px] shrink-0 snap-center" : ""}>
      <Link
        href={`/annonces/${p.id}` as "/annonces"}
        onMouseEnter={() => setSelected(p.id)}
        onFocus={() => setSelected(p.id)}
        className={cn(
          "flex gap-3 rounded-2xl bg-surface p-2 ring-1 transition",
          selected === p.id ? "ring-2 ring-[var(--gold)]" : "ring-border hover:ring-[var(--gold-soft)]",
        )}
      >
        <span className="relative size-[76px] shrink-0 overflow-hidden rounded-xl bg-surface-2">
          {p.photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.photo} alt="" loading="lazy" className="size-full object-cover" />
          ) : (
            <ImageOff className="absolute start-1/2 top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 text-subtle rtl:translate-x-1/2" />
          )}
        </span>
        <span className="min-w-0 flex-1 py-0.5">
          <span className="mazed-tabular block text-[14px] font-extrabold text-foreground">{price(p)}</span>
          <span dir="auto" className="mt-0.5 line-clamp-2 block text-[12.5px] font-semibold leading-snug text-foreground/85">{p.title}</span>
          <span className="mt-0.5 flex items-center gap-1 truncate text-[11.5px] text-muted">
            <MapPin className="size-3 shrink-0" />
            <span className="truncate">{p.place}</span>
            {p.zone && <span className="shrink-0 text-subtle">· {t("zone")}</span>}
          </span>
        </span>
      </Link>
    </li>
  );

  return (
    <div className="mt-4 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-4">
      <div className="relative h-[58vh] min-h-[340px] overflow-hidden rounded-[var(--radius-2xl)] bg-surface-2 ring-1 ring-border lg:h-[calc(100dvh-220px)] lg:min-h-[480px]">
        <div ref={box} className="h-full w-full" role="region" aria-label={t("mapLabel")} />
        {!ready && <MapPin aria-hidden className="absolute start-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 text-subtle" />}
      </div>

      <div className="mt-3 lg:mt-0 lg:flex lg:h-[calc(100dvh-220px)] lg:min-h-[480px] lg:flex-col">
        <p className="text-[12.5px] font-bold text-foreground">
          {t("inView", { count: inView.length })}
          {unplaced > 0 && <span className="font-semibold text-muted"> · {t("unplaced", { count: unplaced })}</span>}
        </p>
        {points.some((p) => p.zone) && <p className="mt-0.5 text-[11.5px] text-subtle">{t("zoneHint")}</p>}
        {inView.length === 0 ? (
          <p className="mt-3 rounded-2xl bg-surface-2 p-4 text-[12.5px] text-muted ring-1 ring-border">{points.length === 0 ? t("none") : t("moveHint")}</p>
        ) : (
          <>
            {/* A phone: a strip of cards under the map, the chosen one brought into view. */}
            <div ref={strip} className="hide-scrollbar -mx-4 mt-2 overflow-x-auto px-4 lg:hidden">
              <ul className="flex snap-x snap-mandatory gap-2.5 pb-1">{inView.map((p) => card(p, "strip"))}</ul>
            </div>
            {/* A desktop: the list beside the map, scrolled on its own. */}
            <ul className="mt-2 hidden min-h-0 flex-1 space-y-2 overflow-y-auto pe-1 lg:block">{inView.map((p) => card(p, "row"))}</ul>
          </>
        )}
      </div>
    </div>
  );
}
