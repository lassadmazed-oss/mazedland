/**
 * Floors and levels — « الطابق » and « الطوابق »: which floor a property is
 * on, and how many levels it spans.
 *
 * Three keys of `attributes`, each optional:
 *
 *   floor       the floor a flat, an office or a shop is on, 0 being the
 *               ground floor (RDC) — and on a house or a villa, the floor
 *               offered when only one floor of it is.
 *   levels      how many levels it spans: a flat 1, 2 (duplex) or 3
 *               (triplex); a whole house or villa 1 (plain-pied) … n.
 *   floor_only  true on a house or a villa of which one floor only is
 *               offered (« Étage de villa », « طابق برك من الدار »). Its
 *               levels is then 1, and `floor` says which floor.
 *
 * A duplex is 2 and a triplex 3 for a flat and a villa alike, so a search for
 * « دوبلكس » finds both (0217 folds the words into search_text).
 *
 * Which questions a category asks is /admin/catalogue's business, and the
 * levels question reads it: asked beside a « floor » question, it is about a
 * unit in a building (one level, duplex, triplex); asked without one, about a
 * whole building (1, 2, 3, 4 and more — or one floor of it, which then asks
 * which floor).
 *
 * Houses and villas were asked « Étage » until 0217, and sellers of a whole
 * villa answered « RDC » (MZ-01706, on two levels). That old answer says
 * nothing sure, so a building's floor is shown only beside floor_only.
 *
 * Pure, so the tests can pin every word.
 */
import type { CountChips } from "./choices";

export type Lang = "fr" | "ar";
export type LevelsStyle = "unit" | "building";

export const FLOOR_KEY = "floor";
export const LEVELS_KEY = "levels";
export const FLOOR_ONLY_KEY = "floor_only";

export const langOf = (locale: string): Lang => (locale === "ar" || locale.startsWith("ar-") ? "ar" : "fr");

/** How a category asks its levels, from the keys of its questions; null when it does not ask them. */
export function levelsStyle(keys: Iterable<string>): LevelsStyle | null {
  const set = new Set(keys);
  if (!set.has(LEVELS_KEY)) return null;
  return set.has(FLOOR_KEY) ? "unit" : "building";
}

/** A flat's levels: one, duplex, triplex. */
export const UNIT_LEVELS: readonly number[] = [1, 2, 3];
/** A whole building's: 1, 2, 3, then « 4 et + », which opens the box. */
export const BUILDING_LEVELS: CountChips = { values: [1, 2, 3], orMore: 4 };
/** Which floor of the house is offered: RDC, 1, 2, then « 3 et + ». */
export const FLOOR_OF_BUILDING: CountChips = { values: [0, 1, 2], orMore: 3 };

/* ── The words ─────────────────────────────────────────────────────────────── */

const AR_ORDINAL = ["الأرضي", "الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر"];
/** « الأرضي », « الأول » … « العاشر », then the figure. */
export const arOrdinal = (n: number) => (n >= 0 && n < AR_ORDINAL.length ? AR_ORDINAL[n] : String(n));
/** « 1er », « 2e », « 3e »… */
export const frOrdinal = (n: number) => (n === 1 ? "1er" : `${n}e`);

/** A count of levels in Arabic: طابق واحد، زوز طوابق، 3 طوابق … 11 طابق. */
export function arLevelCount(n: number): string {
  if (n === 1) return "طابق واحد";
  if (n === 2) return "زوز طوابق";
  return n >= 3 && n <= 10 ? `${n} طوابق` : `${n} طابق`;
}

/**
 * The floor, and the ones above it a duplex or a triplex takes:
 * « الطابق الثالث والرابع », « Du rez-de-chaussée au 2e étage ».
 */
export function floorWords(floor: number, lang: Lang, levels = 1): string {
  const span = Math.max(1, Math.floor(levels));
  const top = floor + span - 1;
  if (lang === "ar") {
    if (span === 1) return floor === 0 ? "طابق أرضي" : `الطابق ${arOrdinal(floor)}`;
    if (span === 2) return `الطابق ${arOrdinal(floor)} و${arOrdinal(top)}`;
    return `من الطابق ${arOrdinal(floor)} للطابق ${arOrdinal(top)}`;
  }
  if (span === 1) return floor === 0 ? "Rez-de-chaussée" : `${frOrdinal(floor)} étage`;
  if (span === 2) return floor === 0 ? "Rez-de-chaussée et 1er étage" : `${frOrdinal(floor)} et ${frOrdinal(top)} étages`;
  return floor === 0 ? `Du rez-de-chaussée au ${frOrdinal(top)} étage` : `Du ${frOrdinal(floor)} au ${frOrdinal(top)} étage`;
}

/**
 * How many levels, the way the chip says it and the annonce shows it. A flat
 * is « عادية » / duplex / triplex; a whole building counts its levels and
 * names the duplex and the triplex beside the count.
 */
export function levelsWords(levels: number, style: LevelsStyle, lang: Lang, slug?: string | null): string {
  if (style === "unit") {
    if (levels === 1) return lang === "ar" ? (slug === "appartements" ? "عادية" : "طابق واحد") : "Un niveau";
    if (levels === 2) return lang === "ar" ? "دوبلكس" : "Duplex";
    if (levels === 3) return lang === "ar" ? "تريبلكس" : "Triplex";
    return lang === "ar" ? arLevelCount(levels) : `${levels} niveaux`;
  }
  if (lang === "ar") {
    if (levels === 2) return "زوز طوابق · دوبلكس";
    if (levels === 3) return "3 طوابق · تريبلكس";
    return arLevelCount(levels);
  }
  if (levels === 1) return "Plain-pied";
  if (levels === 2) return "2 niveaux · duplex";
  if (levels === 3) return "3 niveaux · triplex";
  return `${levels} niveaux`;
}

/** The chip, and the annonce, for one floor of a house offered on its own. */
export function floorOnlyWords(lang: Lang): string {
  return lang === "ar" ? "طابق برك من الدار" : "Un étage de la maison";
}

/** « طابق برك من الدار: الطابق الأول », « Un étage de la maison : rez-de-chaussée ». */
export function floorOfBuildingWords(floor: number | null, lang: Lang): string {
  if (floor === null) return floorOnlyWords(lang);
  if (lang === "ar") return `${floorOnlyWords(lang)}: الطابق ${arOrdinal(floor)}`;
  return `${floorOnlyWords(lang)} : ${floor === 0 ? "rez-de-chaussée" : `${frOrdinal(floor)} étage`}`;
}

/* ── The answers ───────────────────────────────────────────────────────────── */

/** A whole number from an answer, 3 or "3"; null for anything else. */
function whole(v: unknown, min: number): number | null {
  if (v === null || v === undefined || typeof v === "boolean" || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= min ? n : null;
}

export type LevelsAnswers = { floor: number | null; levels: number | null; floorOnly: boolean };

/** The three answers, typed (jsonb) or as the form holds them (strings). */
export function levelsAnswers(attrs: Readonly<Record<string, unknown>>): LevelsAnswers {
  const only = attrs[FLOOR_ONLY_KEY];
  return {
    floor: whole(attrs[FLOOR_KEY], 0),
    levels: whole(attrs[LEVELS_KEY], 1),
    floorOnly: only === true || only === "true",
  };
}

/**
 * What the « floor » or the « levels » question of a category asking `keys`
 * shows on the annonce: the words, null to show nothing, undefined for any
 * other question (the caller formats that one as before).
 *
 *   flat     floor « الطابق الثالث والرابع », levels « دوبلكس » (nothing for
 *            one level: that is the usual flat)
 *   building levels « زوز طوابق · دوبلكس », or « طابق برك من الدار: الطابق
 *            الأول »; its floor is never shown on its own
 */
export function levelsFact(
  key: string,
  attrs: Readonly<Record<string, unknown>>,
  keys: Iterable<string>,
  lang: Lang,
  slug?: string | null,
): string | null | undefined {
  if (key !== FLOOR_KEY && key !== LEVELS_KEY) return undefined;
  const asked = new Set(keys);
  const style = levelsStyle(asked);
  const a = levelsAnswers(attrs);
  if (key === FLOOR_KEY) {
    if (!asked.has(FLOOR_KEY) || a.floor === null) return null;
    return floorWords(a.floor, lang, style === "unit" ? a.levels ?? 1 : 1);
  }
  if (style === "building") {
    if (a.floorOnly) return floorOfBuildingWords(a.floor, lang);
    return a.levels === null ? null : levelsWords(a.levels, "building", lang, slug);
  }
  if (style === "unit") return a.levels === null || a.levels < 2 ? null : levelsWords(a.levels, "unit", lang, slug);
  return null;
}

/**
 * What the levels question writes besides its own key, from the form's
 * strings: on a whole building, « one floor of it » is floor_only, levels 1
 * and the floor chosen. Null when there is nothing to add — and then a
 * building's `floor` is not sent at all, which retires an old « RDC » the
 * next time the seller saves.
 */
export function floorOfBuildingAnswers(
  keys: Iterable<string>,
  raw: Readonly<Record<string, string | undefined>>,
): Record<string, number | boolean> | null {
  if (levelsStyle(keys) !== "building" || raw[FLOOR_ONLY_KEY] !== "true") return null;
  const out: Record<string, number | boolean> = { [FLOOR_ONLY_KEY]: true, [LEVELS_KEY]: 1 };
  const floor = whole(raw[FLOOR_KEY], 0);
  if (floor !== null) out[FLOOR_KEY] = floor;
  return out;
}

/**
 * Duplex and triplex said in words — a CSV's « Type » cell (« Villa duplex »),
 * a « Niveaux » cell — as a level count; null when the words say neither.
 */
export function levelsInWords(raw: string): number | null {
  const s = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  if (/triplex|تريبلكس|تريبليكس/.test(s)) return 3;
  if (/duplex|دوبلكس|دوبليكس|ديبلكس/.test(s)) return 2;
  if (/plain[\s-]*pied|simplex/.test(s)) return 1;
  // « R+1 » is a ground floor and one above: two levels.
  const rPlus = s.match(/\br\s*\+\s*(\d)\b/);
  if (rPlus) return Number(rPlus[1]) + 1;
  return null;
}
