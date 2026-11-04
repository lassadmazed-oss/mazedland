/**
 * An annonce's place on a map (0212) — the pure parts.
 *
 * The seller puts a pin (on the map, from their phone's position, or from a
 * Google Maps link they paste, the way agences send a place on WhatsApp). The
 * pin is kept private; visitors get `publicPoint`: the pin itself when the
 * seller chose « exacte », otherwise a point drawn within the radius, shown
 * as a circle that holds the house without pointing at it.
 */

export type LatLng = { lat: number; lng: number };

/** Tunisia with its islands (Djerba, Kerkennah, La Galite) and a margin; the database checks the same. */
export const TUNISIA_BOUNDS = { south: 30, north: 38, west: 7, east: 12 } as const;

/** Where the map opens with no pin: the whole country. */
export const TUNISIA_VIEW = { center: { lat: 34.2, lng: 9.6 }, zoom: 5.6 } as const;

export function inTunisia(p: LatLng): boolean {
  return (
    Number.isFinite(p.lat) && Number.isFinite(p.lng) &&
    p.lat >= TUNISIA_BOUNDS.south && p.lat <= TUNISIA_BOUNDS.north &&
    p.lng >= TUNISIA_BOUNDS.west && p.lng <= TUNISIA_BOUNDS.east
  );
}

/** Six decimals, the column's precision (about 10 cm). */
export const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** A pin as the body sends it, or null: two finite numbers in Tunisia. */
export function asPin(v: unknown): LatLng | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const lat = typeof o.lat === "string" ? Number(o.lat) : o.lat;
  const lng = typeof o.lng === "string" ? Number(o.lng) : o.lng;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  const p = { lat: round6(lat), lng: round6(lng) };
  return inTunisia(p) ? p : null;
}

// ── Where the map opens: the governorate's town ─────────────────────────────

/** The chief town of each governorate, to open the map near the annonce before a pin is put. */
export const GOVERNORATE_CENTER: Record<string, LatLng> = {
  Tunis: { lat: 36.8065, lng: 10.1815 },
  Ariana: { lat: 36.8625, lng: 10.1956 },
  "Ben Arous": { lat: 36.7531, lng: 10.2189 },
  Manouba: { lat: 36.8101, lng: 10.0956 },
  Sousse: { lat: 35.8256, lng: 10.636 },
  Monastir: { lat: 35.7643, lng: 10.8113 },
  Mahdia: { lat: 35.5047, lng: 11.0622 },
  Nabeul: { lat: 36.4561, lng: 10.7376 },
  Sfax: { lat: 34.7406, lng: 10.7603 },
  Bizerte: { lat: 37.2744, lng: 9.8739 },
  Gabès: { lat: 33.8815, lng: 10.0982 },
  Médenine: { lat: 33.3549, lng: 10.5055 },
  Kairouan: { lat: 35.6781, lng: 10.0963 },
  Béja: { lat: 36.7256, lng: 9.1817 },
  Jendouba: { lat: 36.5011, lng: 8.7802 },
  Kef: { lat: 36.1826, lng: 8.7149 },
  Kasserine: { lat: 35.1676, lng: 8.8365 },
  "Sidi Bouzid": { lat: 35.0382, lng: 9.4849 },
  Gafsa: { lat: 34.425, lng: 8.7842 },
  Tozeur: { lat: 33.9197, lng: 8.1335 },
  Kebili: { lat: 33.7044, lng: 8.969 },
  Tataouine: { lat: 32.9297, lng: 10.4518 },
  Siliana: { lat: 36.0849, lng: 9.3708 },
  Zaghouan: { lat: 36.4029, lng: 10.1429 },
};

// ── Reading a place the seller pasted ───────────────────────────────────────

const NUM = String.raw`(-?\d{1,3}(?:\.\d+)?)`;

/**
 * In the order a Google Maps address means them: `!3d…!4d…` is the place
 * itself, a `q=`/`query=`/`destination=` is what was searched or shared, a
 * `/place/lat,lng` the same, and `@lat,lng` only where the screen was centred.
 */
const URL_PATTERNS: RegExp[] = [
  new RegExp(String.raw`!3d${NUM}!4d${NUM}`),
  new RegExp(String.raw`[?&](?:q|query|ll|sll|center|destination|daddr)=(?:loc:)?${NUM}\s*,\s*\+?${NUM}`),
  new RegExp(String.raw`/(?:place|search|dir/[^/]*)/${NUM}\s*,\s*\+?${NUM}`),
  new RegExp(String.raw`@${NUM},${NUM}`),
];

/** « 34.7406, 10.7603 », « 34.7406 10.7603 », « 34,7406 ; 10,7603 ». */
const PLAIN = /^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,2}(?:[.,]\d+)?)\s*$/;

/** « 34°44'26.2"N 10°45'37.1"E », as Google Maps shows a dropped pin. */
const DMS = /(\d{1,2})°\s*(\d{1,2})['′]\s*(\d{1,2}(?:[.,]\d+)?)["″]?\s*([NS])[\s,]*(\d{1,3})°\s*(\d{1,2})['′]\s*(\d{1,2}(?:[.,]\d+)?)["″]?\s*([EW])/i;

const decode = (s: string) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
};

const pair = (a: string, b: string): LatLng | null => {
  const p = { lat: round6(Number(a.replace(",", "."))), lng: round6(Number(b.replace(",", "."))) };
  return Number.isFinite(p.lat) && Number.isFinite(p.lng) ? p : null;
};

/**
 * The point a pasted text names: a Google Maps address (long form), plain
 * coordinates or degrees-minutes-seconds. Null when none can be read; a point
 * read outside Tunisia is returned with `outside: true` so the form can say so.
 */
export function parseLocation(raw: string): (LatLng & { outside?: true }) | null {
  const text = raw.trim();
  if (!text) return null;
  const tag = (p: LatLng | null) => (p ? (inTunisia(p) ? p : { ...p, outside: true as const }) : null);

  const dms = DMS.exec(text);
  if (dms) {
    const deg = (d: string, m: string, s: string, h: string) =>
      (Number(d) + Number(m) / 60 + Number(s.replace(",", ".")) / 3600) * (/[SW]/i.test(h) ? -1 : 1);
    return tag({ lat: round6(deg(dms[1], dms[2], dms[3], dms[4])), lng: round6(deg(dms[5], dms[6], dms[7], dms[8])) });
  }

  const plain = PLAIN.exec(text);
  if (plain) return tag(pair(plain[1], plain[2]));

  // A consent page wraps the real address in `continue=`.
  const cont = /[?&]continue=([^&\s]+)/.exec(text);
  if (cont && /consent\./i.test(text)) return parseLocation(decode(cont[1]));

  const url = decode(text);
  for (const re of URL_PATTERNS) {
    const m = re.exec(url);
    if (m) return tag(pair(m[1], m[2]));
  }
  return null;
}

/** A short link (maps.app.goo.gl, goo.gl/maps) names no point until it is followed. */
export function isShortMapsLink(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.toLowerCase();
    return u.protocol === "https:" && (host === "maps.app.goo.gl" || (host === "goo.gl" && u.pathname.startsWith("/maps")));
  } catch {
    return false;
  }
}

/** The hosts a short link may lead to, and the only ones the server follows. */
export function isGoogleMapsUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (host === "maps.app.goo.gl" || host === "goo.gl") return true;
    if (/^consent\.google\.[a-z.]+$/.test(host)) return true;
    return /^(www\.|maps\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host);
  } catch {
    return false;
  }
}

// ── What visitors see ───────────────────────────────────────────────────────

const M_PER_DEG_LAT = 111_320;

/**
 * A point drawn between a quarter and three quarters of the radius from the
 * pin, in any direction: the circle of `radiusM` around it always holds the
 * house, which is never at its centre.
 */
export function blurPoint(pin: LatLng, radiusM: number, rand: () => number = Math.random): LatLng {
  const d = radiusM * (0.25 + 0.5 * rand());
  const a = 2 * Math.PI * rand();
  const dLat = (d * Math.cos(a)) / M_PER_DEG_LAT;
  const dLng = (d * Math.sin(a)) / (M_PER_DEG_LAT * Math.cos((pin.lat * Math.PI) / 180));
  return { lat: round6(pin.lat + dLat), lng: round6(pin.lng + dLng) };
}

/** Metres between two points (haversine). */
export function distanceM(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** A circle as a GeoJSON ring of `steps` points, for the map to fill. */
export function circleRing(center: LatLng, radiusM: number, steps = 64): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (2 * Math.PI * i) / steps;
    const dLat = (radiusM * Math.cos(a)) / M_PER_DEG_LAT;
    const dLng = (radiusM * Math.sin(a)) / (M_PER_DEG_LAT * Math.cos((center.lat * Math.PI) / 180));
    ring.push([round6(center.lng + dLng), round6(center.lat + dLat)]);
  }
  return ring;
}

/** Google Maps on the way there (the phone opens its app), for an exact pin only. */
export const directionsUrl = (p: LatLng) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;

/** Google Maps on a point, for the console. */
export const mapsUrl = (p: LatLng) => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
