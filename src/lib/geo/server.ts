/**
 * The server's side of an annonce's place (0212): following a short Google
 * Maps link to the point it names, and the columns a pin writes.
 */
import { blurPoint, isGoogleMapsUrl, isShortMapsLink, parseLocation, type LatLng } from "./location";

const MAX_HOPS = 5;
const TIMEOUT_MS = 6000;

/**
 * The point behind a `maps.app.goo.gl` link: its redirects are followed by
 * hand, on Google's hosts only (the link is the seller's text — the server
 * fetches nothing else), and each address is read on the way. A last page
 * that still names no point is read for the ones Google writes into it.
 */
export async function resolveMapsLink(raw: string): Promise<(LatLng & { outside?: true }) | null> {
  const direct = parseLocation(raw);
  if (direct) return direct;
  if (!isShortMapsLink(raw)) return null;

  let url = raw.trim();
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (!isGoogleMapsUrl(url)) return null;
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Google's consent wall stands in front of the map for a visitor it
      // has not met; it is the same page with the address in `continue=`.
      headers: { "user-agent": "Mozilla/5.0 (compatible; MazedImmo/1.0)", "accept-language": "fr", cookie: "CONSENT=YES+" },
    });
    const next = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && next) {
      url = new URL(next, url).toString();
      const read = parseLocation(url);
      if (read) return read;
      continue;
    }
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 400_000);
    const inPage =
      /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/.exec(html) ??
      /center=(-?\d{1,3}\.\d+)%2C(-?\d{1,3}\.\d+)/.exec(html) ??
      /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+),\d/.exec(html);
    return inPage ? parseLocation(`${inPage[1]}, ${inPage[2]}`) : null;
  }
  return null;
}

/** The columns a pin writes: the pin kept, the point shown (src/lib/geo/location.ts). */
export function pinColumns(pin: LatLng | null, exact: boolean, radiusM: number): Record<string, unknown> {
  if (!pin) return { pin_lat: null, pin_lng: null, lat: null, lng: null, location_exact: false };
  const shown = exact ? pin : blurPoint(pin, radiusM);
  return { pin_lat: pin.lat, pin_lng: pin.lng, lat: shown.lat, lng: shown.lng, location_exact: exact };
}

/**
 * The same, keeping the point already drawn when neither the pin nor the
 * choice changed: saving the form again gives no second sample to average.
 */
export function pinUpdate(
  current: { pin_lat: number | string | null; pin_lng: number | string | null; location_exact: boolean | null },
  pin: LatLng | null,
  exact: boolean,
  radiusM: number,
): Record<string, unknown> | null {
  const same =
    pin && current.pin_lat != null && current.pin_lng != null &&
    Number(current.pin_lat) === pin.lat && Number(current.pin_lng) === pin.lng &&
    !!current.location_exact === exact;
  if (same) return null;
  if (!pin && current.pin_lat == null) return null;
  return pinColumns(pin, exact, radiusM);
}
