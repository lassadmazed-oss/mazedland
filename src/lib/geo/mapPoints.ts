/**
 * The catalogue's map (?vue=carte) — the pure parts: what a bubble says and
 * where an annonce without a pin goes.
 *
 * An annonce with a pin (0212) stands at its public point. One without, when
 * the console allows it (map_show_without_pin), stands in its délégation: at
 * the délégation's centre, moved a little by its id so a dozen annonces of
 * the same délégation are a dozen bubbles and not one — and drawn as a zone,
 * so nobody reads it as an address.
 */
import { round6, type LatLng } from "./location";

/** One annonce on the map, as the page hands it to the browser. */
export type MapPoint = LatLng & {
  id: string;
  title: string;
  price: number | null;
  deal: "sale" | "rent";
  /** Where it is, in words: « Sfax · Sakiet Ezzit ». */
  place: string;
  photo: string | null;
  /** In its délégation only, not a pin of its own. */
  zone: boolean;
};

/**
 * A price short enough for a bubble: « 900 », « 1 500 », « 270 k », « 1,2 M »;
 * « — » for « prix sur demande ». The page's own thousands separator.
 */
export function compactPrice(price: number | null, locale: string): string {
  if (price == null || !Number.isFinite(price) || price <= 0) return "—";
  const tag = locale === "ar" ? "ar-TN-u-nu-latn" : "fr-TN";
  if (price < 10_000) return new Intl.NumberFormat(tag, { maximumFractionDigits: 0 }).format(Math.round(price)).replace(/ | /g, " ");
  if (price < 1_000_000) return `${Math.round(price / 1000)} k`;
  const m = price / 1_000_000;
  return `${new Intl.NumberFormat(tag, { maximumFractionDigits: m < 10 ? 1 : 0 }).format(m)} M`;
}

/** A number from an id, the same every time: where in its délégation an annonce without a pin stands. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/**
 * Around the délégation's centre, within `radiusM`, by the annonce's id: on a
 * sunflower spiral, so many annonces spread evenly instead of stacking.
 */
export function spreadAround(center: LatLng, id: string, radiusM = 700): LatLng {
  const u = hash(id);
  const v = hash(`${id}:a`);
  const d = radiusM * Math.sqrt(0.15 + 0.85 * u);
  const a = 2 * Math.PI * v;
  const dLat = (d * Math.cos(a)) / 111_320;
  const dLng = (d * Math.sin(a)) / (111_320 * Math.cos((center.lat * Math.PI) / 180));
  return { lat: round6(center.lat + dLat), lng: round6(center.lng + dLng) };
}

/** The points inside the map's frame, for the list beside it. */
export function inBounds(points: readonly MapPoint[], b: { south: number; west: number; north: number; east: number }): MapPoint[] {
  return points.filter((p) => p.lat >= b.south && p.lat <= b.north && p.lng >= b.west && p.lng <= b.east);
}
