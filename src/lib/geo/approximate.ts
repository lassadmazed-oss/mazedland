import { delegationCenter } from "./places";
import { GOVERNORATE_CENTER, type LatLng } from "./location";
import { spreadAround } from "./mapPoints";

/** How far around its governorate's centre an annonce without a délégation is spread: a whole governorate is behind it. */
export const GOVERNORATE_SPREAD_M = 2500;

/**
 * Where an annonce without a pin stands on the catalogue's map: around its
 * délégation's centre, or, with no délégation (or one the map does not know),
 * around its governorate's. The owner, 2026-11-12: every annonce on the map,
 * Tunis in Tunis, Ariana in Ariana — 28 of 70 had no délégation and were only
 * counted. Either way it is drawn as a zone, never as an address.
 *
 * For the server: places.ts is large and stays out of the browser's bundle.
 */
export function approximatePoint(gov: string, del: string | null, id: string): LatLng | null {
  const centre = delegationCenter(gov, del);
  if (centre) return spreadAround(centre, id);
  const capital = GOVERNORATE_CENTER[gov];
  return capital ? spreadAround(capital, id, GOVERNORATE_SPREAD_M) : null;
}
