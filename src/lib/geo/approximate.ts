import { delegationCenter } from "./places";
import { GOVERNORATE_CENTER, type LatLng } from "./location";
import { spreadAround } from "./mapPoints";
import { findQuartier } from "./quartier";

/** How far around a quartier's centre an annonce is spread: a few streets. */
export const QUARTIER_SPREAD_M = 300;

/** How far around its governorate's centre an annonce without a délégation is spread: a whole governorate is behind it. */
export const GOVERNORATE_SPREAD_M = 2500;

/**
 * Where an annonce without a pin stands on the catalogue's map, as close as
 * what its seller wrote allows: around the quartier its address names
 * (src/lib/geo/quartier.ts), else its délégation's centre, else — no
 * délégation, or one the map does not know — its governorate's. The owner,
 * 2026-11-12: every annonce on the map, Tunis in Tunis, Ariana in Ariana, and
 * the quartier when it is known. Either way it is drawn as a zone, never as
 * an address.
 *
 * For the server: places.ts and quartiers.ts are large and stay out of the
 * browser's bundle.
 */
export function approximatePoint(gov: string, del: string | null, id: string, address?: string | null): LatLng | null {
  const quartier = findQuartier(gov, del, address);
  if (quartier) return spreadAround(quartier.at, id, QUARTIER_SPREAD_M);
  const centre = delegationCenter(gov, del);
  if (centre) return spreadAround(centre, id);
  const capital = GOVERNORATE_CENTER[gov];
  return capital ? spreadAround(capital, id, GOVERNORATE_SPREAD_M) : null;
}
