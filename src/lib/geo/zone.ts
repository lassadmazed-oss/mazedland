/**
 * A zone drawn on the map with a finger (0213) — the pure parts.
 *
 * On the catalogue map a visitor traces a contour; the annonces inside it are
 * the search, the address carries it (`zone=lat,lng;lat,lng;…`), and a
 * demande can keep it: an alert then only goes for an annonce standing in it.
 * A zone is a closed ring of [lat, lng] points, at most ZONE_MAX_POINTS, all
 * in Tunisia.
 */
import { inTunisia, type LatLng } from "./location";

export type Zone = [number, number][];

export const ZONE_MIN_POINTS = 3;
export const ZONE_MAX_POINTS = 60;

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

/**
 * A zone from the address (`34.74,10.76;…`) or a body ([[lat, lng], …]), or
 * null: too few points, a point that does not read, or one outside Tunisia.
 */
export function parseZone(v: unknown): Zone | null {
  let pairs: unknown[];
  if (typeof v === "string") pairs = v.split(";").map((p) => p.split(","));
  else if (Array.isArray(v)) pairs = v;
  else return null;
  if (pairs.length < ZONE_MIN_POINTS || pairs.length > ZONE_MAX_POINTS) return null;
  const zone: Zone = [];
  for (const p of pairs) {
    if (!Array.isArray(p) || p.length !== 2) return null;
    const lat = Number(p[0]);
    const lng = Number(p[1]);
    if (!inTunisia({ lat, lng })) return null;
    zone.push([r4(lat), r4(lng)]);
  }
  return zone;
}

/** The address form of a zone: four decimals (about 10 m) are plenty for a contour. */
export const zoneParam = (zone: Zone): string => zone.map(([lat, lng]) => `${r4(lat)},${r4(lng)}`).join(";");

/** Whether a point stands inside the zone (ray casting; the ring closes itself). */
export function inZone(p: LatLng, zone: Zone): boolean {
  let inside = false;
  for (let i = 0, j = zone.length - 1; i < zone.length; j = i++) {
    const [yi, xi] = zone[i];
    const [yj, xj] = zone[j];
    if (yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The zone's frame: [[west, south], [east, north]], as the map fits it. */
export function zoneBounds(zone: Zone): [[number, number], [number, number]] {
  const lats = zone.map((p) => p[0]);
  const lngs = zone.map((p) => p[1]);
  return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
}

type XY = { x: number; y: number };

/** Distance from a point to a segment, in the same units (screen pixels). */
function toSegment(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * A traced line with only the points that shape it (Ramer–Douglas–Peucker),
 * in screen pixels: a finger gives hundreds, a contour needs a few dozen.
 * The tolerance grows until the zone fits ZONE_MAX_POINTS.
 */
export function simplifyPath(points: readonly XY[], tolerance = 3, max = ZONE_MAX_POINTS): XY[] {
  if (points.length <= 2) return [...points];
  const rdp = (pts: readonly XY[], eps: number): XY[] => {
    let worst = 0;
    let at = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = toSegment(pts[i], pts[0], pts[pts.length - 1]);
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (worst <= eps) return [pts[0], pts[pts.length - 1]];
    return [...rdp(pts.slice(0, at + 1), eps).slice(0, -1), ...rdp(pts.slice(at), eps)];
  };
  let eps = tolerance;
  let out = rdp(points, eps);
  while (out.length > max) {
    eps *= 1.5;
    out = rdp(points, eps);
  }
  return out;
}
