/**
 * The site's maps (0212): MapLibre, drawing OpenStreetMap through
 * OpenFreeMap — free, no key, no card, no quota (the owner chose it over
 * Google Maps on 2026-11-04). Loaded only where a map is shown, so a page
 * without one carries none of its weight.
 *
 * Its worker and the plugin that joins Arabic letters (mapbox-gl-rtl-text)
 * are served by the site itself from public/maplibre/, named after their
 * version: a bundle cannot point MapLibre at a worker file it does not
 * know, and the CSP allows no other script host. map.test.ts checks the
 * copies match the installed packages.
 */
import type * as MapLibre from "maplibre-gl";

export const MAPLIBRE_VERSION = "6.15.0";
export const RTL_TEXT_VERSION = "0.3.0";

/** The OpenFreeMap style: streets, places and buildings, names in Latin and Arabic. Its host is in the CSP (next.config.ts). */
export const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

export const MAP_WORKER_URL = `/maplibre/maplibre-gl-worker-${MAPLIBRE_VERSION}.mjs`;
// .mjs: MapLibre 6's worker imports a module, and would eval() a classic
// script — which the CSP refuses.
export const RTL_TEXT_URL = `/maplibre/mapbox-gl-rtl-text-${RTL_TEXT_VERSION}.mjs`;

let loading: Promise<typeof MapLibre> | null = null;

/** MapLibre, set up once per page: its worker, and the Arabic plugin loaded when a name needs it. */
export function loadMapLibre(): Promise<typeof MapLibre> {
  loading ??= import("maplibre-gl").then((m) => {
    m.setWorkerUrl(MAP_WORKER_URL);
    if (m.getRTLTextPluginStatus() === "unavailable") {
      void m.setRTLTextPlugin(RTL_TEXT_URL, true).catch(() => {});
    }
    return m;
  });
  return loading;
}
