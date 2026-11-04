"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Bell, ImageOff, LocateFixed, MapPin, PenLine, X } from "lucide-react";
import type * as MapLibre from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Link, useRouter } from "@/i18n/navigation";
import { TUNISIA_VIEW, distanceM, type LatLng } from "@/lib/geo/location";
import { compactPrice, inBounds, type MapPoint } from "@/lib/geo/mapPoints";
import { inZone, parseZone, simplifyPath, zoneBounds, zoneParam, type Zone } from "@/lib/geo/zone";
import { formatNumber, formatTND, cn } from "@/lib/utils";
import { MAP_STYLE, loadMapLibre } from "./maplibre";

/**
 * « Carte » in the catalogue (?vue=carte, 0212): the annonces of the search
 * as price bubbles, gathered into numbered circles when far apart, and beside
 * the map the ones in its frame — moving the map is searching there. A bubble
 * drawn dashed is an annonce without a pin, standing in its délégation
 * (MapPoint.zone).
 *
 * Two more ways to search (0213): « Dessiner une zone » — a contour traced
 * with a finger, kept in the address (`zone=`) and, with « M'alerter dans
 * cette zone », on a demande; and « Près de moi », which finds the visitor
 * and sorts the list by distance.
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

const EMPTY = { type: "FeatureCollection" as const, features: [] };
const ring = (zone: Zone) => [...zone, zone[0]].map(([lat, lng]) => [lng, lat]);

export function CatalogueMap({
  points,
  unplaced,
  start,
  initialZone,
  alertBase,
  locale,
}: {
  points: MapPoint[];
  /** Annonces of the search the map cannot place (no pin, no délégation). */
  unplaced: number;
  /** Where to open when the search names a governorate; otherwise around the points. */
  start: { center: LatLng; zoom: number } | null;
  /** The zone the address carries (`zone=`). */
  initialZone: Zone | null;
  /** « Enregistrer ma demande » for this search, to which the zone is added; null when demandes are off. */
  alertBase: string | null;
  locale: string;
}) {
  const t = useTranslations("catalogueMap");
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibre.Map | null>(null);
  const geo = useRef<MapLibre.GeolocateControl | null>(null);
  const [frame, setFrame] = useState<{ south: number; west: number; north: number; east: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [zone, setZone] = useState<Zone | null>(initialZone);
  const [drawing, setDrawing] = useState(false);
  const [drawError, setDrawError] = useState(false);
  const [me, setMe] = useState<LatLng | null>(null);
  const [geoError, setGeoError] = useState(false);

  // The search's points, inside the zone when one is drawn.
  const shown = useMemo(() => (zone ? points.filter((p) => inZone(p, zone)) : points), [points, zone]);
  // The ones in the map's frame, nearest first once the visitor is found.
  const listed = useMemo(() => {
    const inView = frame ? inBounds(shown, frame) : shown;
    return me ? [...inView].sort((a, b) => distanceM(me, a) - distanceM(me, b)) : inView;
  }, [shown, frame, me]);

  const geojson = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: shown.map((p) => ({
        type: "Feature" as const,
        properties: { id: p.id, label: compactPrice(p.price, locale), zone: p.zone },
        geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
      })),
    }),
    [shown, locale],
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
      // « Près de moi »: the phone's position, a blue dot, and the list by distance.
      const locate = new m.GeolocateControl({
        positionOptions: { enableHighAccuracy: true, timeout: 12_000 },
        trackUserLocation: false,
        // Wide enough for the annonces around, not only the street: the list is the frame.
        fitBoundsOptions: { maxZoom: 12.5 },
      });
      locate.on("geolocate", (e: unknown) => {
        const c = (e as GeolocationPosition).coords;
        setMe({ lat: c.latitude, lng: c.longitude });
        setGeoError(false);
      });
      locate.on("error", () => setGeoError(true));
      mp.addControl(locate, "top-right");
      geo.current = locate;

      mp.on("load", () => {
        for (const [name, fill, stroke, dashed] of [
          ["bubble", PAPER, INK, false],
          ["bubble-zone", PAPER, "#71717a", true],
          ["bubble-on", INK, INK, false],
        ] as const) {
          const b = bubble(fill, stroke, dashed);
          mp.addImage(name, b.image, b.options);
        }
        // The drawn zone under the bubbles, and the line while it is traced.
        mp.addSource("zone", { type: "geojson", data: EMPTY });
        mp.addLayer({ id: "zone-fill", type: "fill", source: "zone", paint: { "fill-color": INK, "fill-opacity": 0.08 } });
        mp.addLayer({ id: "zone-line", type: "line", source: "zone", paint: { "line-color": INK, "line-width": 2.5 } });
        mp.addSource("draft", { type: "geojson", data: EMPTY });
        mp.addLayer({ id: "draft-line", type: "line", source: "draft", paint: { "line-color": INK, "line-width": 3, "line-dasharray": [2, 1] } });

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

        // Open on the search's points, unless it named a governorate (a zone fits itself below).
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
        setFrame({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() });
      });
    });
    return () => {
      gone = true;
      created?.remove();
      map.current = null;
      geo.current = null;
    };
    // The map is made once; its data follow below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The bubbles follow the zone.
  useEffect(() => {
    if (!ready) return;
    (map.current?.getSource("annonces") as MapLibre.GeoJSONSource | undefined)?.setData(geojson);
  }, [geojson, ready]);

  // The zone drawn, and the map on it.
  useEffect(() => {
    const mp = map.current;
    if (!ready || !mp) return;
    (mp.getSource("zone") as MapLibre.GeoJSONSource | undefined)?.setData(
      zone ? { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring(zone)] } } : EMPTY,
    );
    if (zone) mp.fitBounds(zoneBounds(zone), { padding: 40, maxZoom: 15 });
  }, [zone, ready]);

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

  /** The zone kept, or taken away, in the address — so the filters, a reload and a shared link keep it. */
  function commitZone(next: Zone | null) {
    setZone(next);
    setSelected(null);
    const u = new URL(window.location.href);
    if (next) u.searchParams.set("zone", zoneParam(next));
    else u.searchParams.delete("zone");
    const path = u.pathname.replace(/^\/(fr|ar)(?=\/|$)/, "") || "/";
    router.replace(`${path}${u.search}` as "/annonces", { scroll: false });
  }

  // Tracing: the map stops moving under the finger, the line follows it, and
  // on release it becomes the zone — the points that shape it, at most 60.
  useEffect(() => {
    const mp = map.current;
    if (!drawing || !ready || !mp) return;
    const el = mp.getCanvasContainer();
    const handlers = [mp.dragPan, mp.dragRotate, mp.scrollZoom, mp.doubleClickZoom, mp.touchZoomRotate, mp.boxZoom];
    for (const h of handlers) h.disable();
    el.style.touchAction = "none";
    el.style.cursor = "crosshair";
    let path: { x: number; y: number }[] = [];
    let down = false;
    const at = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const lngLat = (p: { x: number; y: number }) => mp.unproject([p.x, p.y]);
    const draft = () =>
      (mp.getSource("draft") as MapLibre.GeoJSONSource).setData({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: path.map((p) => { const ll = lngLat(p); return [ll.lng, ll.lat]; }) },
      });
    const onDown = (e: PointerEvent) => {
      down = true;
      path = [at(e)];
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      const p = at(e);
      const last = path[path.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) >= 3) {
        path.push(p);
        draft();
      }
    };
    const onUp = () => {
      if (!down) return;
      down = false;
      (mp.getSource("draft") as MapLibre.GeoJSONSource).setData(EMPTY);
      const traced = simplifyPath(path, 3).map((p) => { const ll = lngLat(p); return [ll.lat, ll.lng]; });
      const next = parseZone(traced);
      setDrawError(!next);
      if (next) commitZone(next);
      setDrawing(false);
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      for (const h of handlers) h.enable();
      el.style.touchAction = "";
      el.style.cursor = "";
    };
    // commitZone reads the address at the moment of release.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing, ready]);

  const price = (p: MapPoint) =>
    p.price == null
      ? t("onRequest")
      : t(p.deal === "rent" ? "perMonth" : "amount", { amount: formatTND(p.price, locale) });

  const away = (p: MapPoint) => {
    if (!me) return null;
    const d = distanceM(me, p);
    return d < 1000
      ? t("distanceM", { m: formatNumber(Math.round(d / 10) * 10, locale) })
      : t("distanceKm", { km: new Intl.NumberFormat(locale === "ar" ? "ar-TN-u-nu-latn" : "fr-TN", { maximumFractionDigits: d < 10_000 ? 1 : 0 }).format(d / 1000) });
  };

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
            {me && <span className="shrink-0 font-bold text-foreground">· {away(p)}</span>}
          </span>
        </span>
      </Link>
    </li>
  );

  const pill = "tap-target inline-flex h-9 items-center gap-1.5 rounded-full bg-surface px-3.5 text-[12.5px] font-bold text-foreground shadow-[var(--shadow-sm)] ring-1 ring-border transition hover:ring-foreground/40";
  const alertHref = zone && alertBase ? `${alertBase}${alertBase.includes("?") ? "&" : "?"}zone=${encodeURIComponent(zoneParam(zone))}` : null;

  return (
    <div className="mt-4 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-4">
      <div className="relative h-[58vh] min-h-[340px] overflow-hidden rounded-[var(--radius-2xl)] bg-surface-2 ring-1 ring-border lg:h-[calc(100dvh-220px)] lg:min-h-[480px]">
        <div ref={box} className="h-full w-full" role="region" aria-label={t("mapLabel")} />
        {!ready && <MapPin aria-hidden className="absolute start-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 text-subtle" />}
        {/* On the left whatever the language: MapLibre's own buttons are on the right. */}
        {ready && (
          <div className="absolute left-2 top-2 z-10 flex max-w-[calc(100%-64px)] flex-wrap gap-2">
            {drawing ? (
              <>
                <span className="inline-flex h-9 items-center rounded-full bg-foreground px-3.5 text-[12.5px] font-bold text-[var(--background)] shadow-[var(--shadow-sm)]">
                  {t("drawHint")}
                </span>
                <button type="button" onClick={() => setDrawing(false)} className={pill}>
                  <X className="size-4" /> {t("drawCancel")}
                </button>
              </>
            ) : (
              <>
                {zone ? (
                  <button type="button" onClick={() => commitZone(null)} className={pill}>
                    <X className="size-4" /> {t("zoneClear")}
                  </button>
                ) : (
                  <button type="button" onClick={() => { setDrawError(false); setDrawing(true); }} className={pill}>
                    <PenLine className="size-4" /> {t("draw")}
                  </button>
                )}
                <button type="button" onClick={() => geo.current?.trigger()} className={pill}>
                  <LocateFixed className="size-4" /> {t("nearMe")}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 lg:mt-0 lg:flex lg:h-[calc(100dvh-220px)] lg:min-h-[480px] lg:flex-col">
        <p className="text-[12.5px] font-bold text-foreground">
          {zone ? t("inZone", { count: listed.length }) : t("inView", { count: listed.length })}
          {unplaced > 0 && <span className="font-semibold text-muted"> · {t("unplaced", { count: unplaced })}</span>}
        </p>
        {points.some((p) => p.zone) && <p className="mt-0.5 text-[11.5px] text-subtle">{t("zoneHint")}</p>}
        {me && <p className="mt-0.5 text-[11.5px] font-semibold text-muted">{t("sortedByDistance")}</p>}
        {geoError && <p role="alert" className="mt-1 text-[12px] font-bold text-[var(--tone-warn)]">{t("geoFailed")}</p>}
        {drawError && <p role="alert" className="mt-1 text-[12px] font-bold text-[var(--tone-warn)]">{t("drawFailed")}</p>}
        {alertHref && (
          <Link href={alertHref as never} className="mazed-btn-luxe tap-target mt-2 inline-flex h-10 items-center justify-center gap-1.5 rounded-full px-4 text-[13px]">
            <Bell className="size-4" /> {t("alertZone")}
          </Link>
        )}
        {listed.length === 0 ? (
          <p className="mt-3 rounded-2xl bg-surface-2 p-4 text-[12.5px] text-muted ring-1 ring-border">
            {points.length === 0 ? t("none") : zone ? t("noneInZone") : t("moveHint")}
          </p>
        ) : (
          <>
            {/* A phone: a strip of cards under the map, the chosen one brought into view. */}
            <div className="hide-scrollbar -mx-4 mt-2 overflow-x-auto px-4 lg:hidden">
              <ul className="flex snap-x snap-mandatory gap-2.5 pb-1">{listed.map((p) => card(p, "strip"))}</ul>
            </div>
            {/* A desktop: the list beside the map, scrolled on its own. */}
            <ul className="mt-2 hidden min-h-0 flex-1 space-y-2 overflow-y-auto pe-1 lg:block">{listed.map((p) => card(p, "row"))}</ul>
          </>
        )}
      </div>
    </div>
  );
}
