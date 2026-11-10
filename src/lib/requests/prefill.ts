/**
 * A demande started from a catalogue search (0168).
 *
 * « Enregistrer ma demande » under the results passes the search along, and
 * the form opens on it, so nothing is typed twice. What the demande model
 * holds becomes its criteria: the deal, the category, the governorate, the
 * budget, a minimum surface and number of rooms, and for a rental the
 * furniture and the date. The words searched are not a criterion — an alert
 * checks those conditions, never the text of an annonce — so they go in
 * « Autres souhaits », and the form says so before anything is saved. The
 * keyword used to be dropped on the way: « Teniour » searched, a demande
 * with no trace of it.
 *
 * Pure, so the mapping is tested without a page.
 */
import { asDealType, FURNISHED, isoDay, type DealType, type Furnished } from "@/lib/listings/deal";
import { TUNISIAN_GOVERNORATES } from "@/lib/tunisia";
import { findCategory } from "@/lib/catalog/browse";
import { parseZone, type Zone } from "@/lib/geo/zone";

/** The form holds strings, because inputs do; the API types them. */
export type RequestFormValue = {
  deal_type: DealType;
  category_ids: string[];
  governorates: string[];
  budget_min: string;
  budget_max: string;
  surface_min: string;
  rooms_min: string;
  furnished: Furnished | "";
  move_in_by: string;
  note: string;
  alerts: boolean;
  /** A zone drawn on the catalogue map (0213), kept as drawn. */
  zone: Zone | null;
};

/** The note's length on the form and in the API. */
export const NOTE_MAX = 500;

/** The catalogue filters a search can carry, besides the deal and the words. */
const SEARCH_FILTERS = ["cat", "gov", "min", "max", "surface", "rooms", "q", "zone"] as const;

export type SearchPrefill = {
  value: RequestFormValue;
  /** The words searched, now in the note; null when there were none. */
  words: string | null;
  /** A search over sales AND rentals: a demande is one of the two, and the
   *  form asks the person to check which rather than pass the guess off. */
  anyDeal: boolean;
};

const positive = (v: string | undefined): string => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? String(n) : "";
};

export function requestFormFromSearch(
  sp: Record<string, string | undefined>,
  categories: readonly { id: string; slug: string }[],
): SearchPrefill {
  const deal = asDealType(sp.deal);
  const rent = deal === "rent";
  // Accepts the slug the catalogue sends, or an id (see findCategory).
  const cat = findCategory(sp.cat, categories);
  const words = (sp.q ?? "").trim().replace(/\s+/g, " ").slice(0, NOTE_MAX) || null;
  const rooms = Math.floor(Number(sp.rooms));
  const searched = SEARCH_FILTERS.some((k) => (sp[k] ?? "").trim() !== "");

  return {
    value: {
      deal_type: deal,
      category_ids: cat ? [cat.id] : [],
      governorates: sp.gov && (TUNISIAN_GOVERNORATES as readonly string[]).includes(sp.gov) ? [sp.gov] : [],
      budget_min: positive(sp.min),
      budget_max: positive(sp.max),
      surface_min: positive(sp.surface),
      // The model's own bounds (parseRequestInput).
      rooms_min: rooms >= 1 && rooms <= 10 ? String(rooms) : "",
      furnished: rent && (FURNISHED as readonly string[]).includes(sp.furnished ?? "") ? (sp.furnished as Furnished) : "",
      move_in_by: rent ? isoDay(sp.avail) ?? "" : "",
      note: words ?? "",
      alerts: true,
      zone: parseZone(sp.zone),
    },
    words,
    anyDeal: searched && sp.deal !== "sale" && sp.deal !== "rent",
  };
}

/**
 * Where a demande was started from (2026-11-10): the catalogue's line above
 * the results, its card among them, its empty state and its bottom band, the
 * map's zone button, an annonce, the home page. Carried as `via=` to the form
 * and counted twice: the tap (`demande_cta`) and the demande saved
 * (`demande_create`), so the console shows which place brings demandes.
 */
export const DEMANDE_VIA = ["top", "card", "empty", "bottom", "map", "listing", "home"] as const;
export type DemandeVia = (typeof DEMANDE_VIA)[number];

/** A `via=` value as the form may count it; anything else is no place at all. */
export function demandeVia(raw: string | undefined | null): DemandeVia | null {
  return (DEMANDE_VIA as readonly string[]).includes(raw ?? "") ? (raw as DemandeVia) : null;
}

/**
 * A budget a person would type: rounded UP to two significant digits
 * (316 250 → 320 000, 825 → 830, 1 595 → 1 600), so the ceiling never falls
 * under what was asked.
 */
export function roundBudgetUp(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  const step = 10 ** Math.max(0, Math.floor(Math.log10(n)) - 1);
  return Math.ceil(n / step) * step;
}

/**
 * « Pas tout à fait ? » under an annonce: a demande like this one — the same
 * deal, type and governorate, and a budget up to its price plus `marginPercent`
 * (none when the price is on request). The form opens on it; every field can
 * still be changed there.
 */
export function requestHrefFromListing(
  l: { deal: DealType; categorySlug: string | null; governorate: string | null; price: number | null; priceOnRequest: boolean },
  marginPercent: number,
): string {
  const p = new URLSearchParams({ deal: l.deal });
  if (l.categorySlug) p.set("cat", l.categorySlug);
  if (l.governorate && (TUNISIAN_GOVERNORATES as readonly string[]).includes(l.governorate)) p.set("gov", l.governorate);
  if (!l.priceOnRequest && l.price != null && l.price > 0) {
    const max = roundBudgetUp(l.price * (1 + Math.max(0, marginPercent) / 100));
    if (max > 0) p.set("max", String(max));
  }
  p.set("via", "listing");
  return `/demandes/nouvelle?${p.toString()}`;
}
