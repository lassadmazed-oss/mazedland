/**
 * The governorate a place name belongs to, from the site's own lists: a
 * délégation (src/lib/delegations.ts), or a quartier / imada of one
 * (src/lib/geo/quartiers.ts, OpenStreetMap). « La Marsa Ville » → Tunis,
 * « Menzah 5 » → Ariana, « Chotrana 3 » → Ariana, « Manar 1 » → Tunis.
 *
 * Used where a reading of a post names the neighbourhood but not the
 * governorate (Prospection, 2026-11-26: the faster model leaves it empty where
 * the post only says « Menzah 5 »). A name decides only when ONE governorate
 * knows it — as a name of its own, or inside a longer one: « Ennasr » (Bizerte,
 * and Cité Ennasr in Ariana) or « Soukra » (Sfax, and La Soukra in Ariana) say
 * nothing, and the team picks. A wrong governorate is worse than an empty one.
 * Server-only: the quartier list is large.
 */
import { DELEGATIONS, governorateOfDelegation } from "@/lib/delegations";
import { core } from "@/lib/geo/quartier";
import { QUARTIERS } from "@/lib/geo/quartiers";
import { TUNISIAN_GOVERNORATES, type TunisianGovernorate } from "@/lib/tunisia";
import { governoratesNamedIn } from "@/lib/geo/governorateAliases";

/** Shorter than this, a name is inside too many others to mean anything. */
const MIN_NAME = 4;

let names: Map<TunisianGovernorate, string[]> | null = null;

/** Every délégation and quartier name of each governorate, French and Arabic, normalized once. */
function namesByGovernorate(): Map<TunisianGovernorate, string[]> {
  if (names) return names;
  names = new Map();
  for (const g of TUNISIAN_GOVERNORATES) {
    const list = new Set<string>();
    for (const [fr, ar] of DELEGATIONS[g]) {
      list.add(core(fr));
      list.add(core(ar));
    }
    for (const [key, quartiers] of Object.entries(QUARTIERS)) {
      if (!key.startsWith(`${g}|`)) continue;
      for (const q of quartiers) {
        list.add(core(q[0]));
        list.add(core(q[1]));
      }
    }
    names.set(g, [...list].filter(Boolean));
  }
  return names;
}

/** The name as written without « ville / centre », as written, and without a trailing number. */
function variants(place: string): string[] {
  const out: string[] = [];
  // « Ville / Centre » first off: « La Marsa Ville » is the délégation La Marsa (Tunis),
  // not the quartier « La Marsa » of Médenine.
  const bare = place.replace(/\s+(ville|centre|center|centre-ville)$/iu, "").trim();
  for (const p of [bare, place, bare.replace(/\s+\d+$/u, "")]) {
    const t = p.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

export function governorateFromPlace(place: string | null | undefined): TunisianGovernorate | null {
  if (!place?.trim()) return null;
  const known = namesByGovernorate();
  // Most precise first; the first name any list knows decides: « Menzah 5 » is a
  // quartier of Ariana, while « El Menzah » (the number gone) is a délégation of Tunis.
  for (const v of variants(place.trim())) {
    const byDelegation = governorateOfDelegation(v);
    if (byDelegation) return byDelegation;
    const key = core(v);
    if (key.length < MIN_NAME) continue;
    const hits: TunisianGovernorate[] = [];
    for (const [g, list] of known) {
      if (list.some((n) => n === key || ` ${n} `.includes(` ${key} `))) hits.push(g);
    }
    if (hits.length === 1) return hits[0];
    // Known in several governorates: a vaguer form of it would only be vaguer.
    if (hits.length > 1) return null;
  }
  return null;
}

/**
 * Whether a text writes this governorate's name, French or Arabic, as a word
 * (« Tunis » is not in « Tunisie »). The post's own words outrank the lists:
 * « Bhira, Bizerte » is Bizerte even though the quartier list knows a Bhira in
 * Médenine only (2026-11-26).
 */
export function textNamesGovernorate(text: string | null | undefined, governorate: string | null | undefined): boolean {
  if (!text || !governorate) return false;
  // Any spelling of it, as a word, not as a road (« route de Gabès »): src/lib/geo/governorateAliases.ts.
  return (governoratesNamedIn(text) as string[]).includes(governorate);
}

/**
 * The governorate of a post, settled from three witnesses (2026-11-26): the
 * model's reading, the place it read (the délégation / quartier lists), and the
 * governorates the post writes itself (any spelling, roads left out).
 *
 *   1. The model and the lists agree: that is it (« agence à Tunis, villa à
 *      Hammamet » stays Nabeul).
 *   2. The post writes one governorate: that one (« à Qibli – route de Gabès »
 *      is Kebili though the model said Tozeur; « Bhira, Bizerte » is Bizerte
 *      though the lists know a Bhira in Médenine only).
 *   3. The lists know the place and the post does not write the model's
 *      governorate: the lists' (« Menzah 5 » → Ariana, the model said Tunis).
 *   4. Otherwise the model's, or nothing.
 */
export function settleGovernorate(input: {
  model: TunisianGovernorate | null;
  place: string | null;
  text: string;
}): TunisianGovernorate | null {
  const fromPlace = governorateFromPlace(input.place);
  if (fromPlace && fromPlace === input.model) return fromPlace;
  const named = governoratesNamedIn(input.text);
  if (named.length === 1) return named[0];
  if (fromPlace && !textNamesGovernorate(input.text, input.model)) return fromPlace;
  return input.model;
}
