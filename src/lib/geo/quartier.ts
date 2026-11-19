import { canonicalDelegation, delegationsOf, placeKey } from "@/lib/delegations";
import { QUARTIERS, type Quartier } from "./quartiers";
import type { LatLng } from "./location";

/**
 * The quartiers under a délégation (src/lib/geo/quartiers.ts, from
 * OpenStreetMap): what the form suggests in « Quartier », and where the map
 * puts an annonce whose seller named one. Server-only: the list is large.
 */

/** A quartier found in an address, with the délégation it belongs to. */
export type FoundQuartier = { delegation: string; fr: string; ar: string; at: LatLng };

/**
 * A place name as compared: the site's placeKey, with the Arabic comma and
 * question mark as word breaks (placeKey keeps the whole Arabic block), letter
 * variants folded, and without « El », « La », « Cité », « ال »…
 */
function core(s: string): string {
  const key = placeKey(s.replace(/[،؛؟ـ]/g, " "));
  return ` ${key.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")} `
    .replace(/ (?:el|al|la|le|les|l|cite|hay|حي) /g, " ")
    .replace(/ (?:el|al|la|le|les|l|cite|hay|حي) /g, " ")
    .replace(/ ال(?=\S)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Shorter than this, a name matches inside too many addresses to mean anything. */
const MIN_NAME = 4;

/** Each délégation's quartiers with the forms of their names that are compared, built once. */
const INDEX = new Map<string, { q: Quartier; names: string[] }[]>();
function indexed(key: string): { q: Quartier; names: string[] }[] {
  let list = INDEX.get(key);
  if (!list) {
    list = (QUARTIERS[key] ?? []).map((q) => ({ q, names: [...new Set([core(q[0]), core(q[1])])].filter((n) => n.length >= MIN_NAME) }));
    INDEX.set(key, list);
  }
  return list;
}

/** The quartiers of a délégation, A→Z; none when the délégation is not on the site's list. */
export function quartiersOf(gov: string | null | undefined, del: string | null | undefined): Quartier[] {
  const d = canonicalDelegation(gov, del);
  return gov && d ? [...(QUARTIERS[`${gov}|${d}`] ?? [])] : [];
}

/** Every quartier of a governorate with its délégation: what the form offers while the délégation is still empty. */
export function quartiersOfGovernorate(gov: string | null | undefined): { delegation: string; q: Quartier }[] {
  return delegationsOf(gov).flatMap((delegation) => (QUARTIERS[`${gov}|${delegation}`] ?? []).map((q) => ({ delegation, q })));
}

/**
 * The quartier an address names: the longest quartier name found in it as
 * whole words, French or Arabic — among the annonce's délégation's, or across
 * its governorate when it has none. « Sousse , Sahloul » → Sahloul, in Hammam
 * Sousse; « Nabeul Hammamet Nord , Mrezga » → Hammamet Nord, the longer name.
 */
export function findQuartier(
  gov: string | null | undefined,
  del: string | null | undefined,
  text: string | null | undefined,
): FoundQuartier | null {
  if (!gov || !text?.trim()) return null;
  const words = ` ${core(text)} `;
  const own = canonicalDelegation(gov, del);
  let best: { length: number; found: FoundQuartier } | null = null;
  for (const delegation of own ? [own] : delegationsOf(gov)) {
    for (const { q, names } of indexed(`${gov}|${delegation}`)) {
      for (const name of names) {
        if (!words.includes(` ${name} `) || (best && best.length >= name.length)) continue;
        best = { length: name.length, found: { delegation, fr: q[0], ar: q[1], at: { lat: q[2], lng: q[3] } } };
      }
    }
  }
  return best?.found ?? null;
}
