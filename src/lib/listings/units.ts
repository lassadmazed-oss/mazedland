/**
 * What an immeuble holds — « عمارة »: how many flats of which size, and the
 * shops, offices and garages on its ground floor (0232).
 *
 * One question of the category, `units`, answered as a short string so it
 * travels like every other answer of the form (a string in the wizard, a
 * jsonb string in `attributes`, 200 characters at most):
 *
 *   s2:4:95:rented;s3:2;shop:1:40
 *   │  │ │  └ rented | free (optional)
 *   │  │ └ the surface of one, in m² (optional)
 *   │  └ how many
 *   └ the kind
 *
 * « 4 × S+2 of 95 m², rented · 2 × S+3 · 1 shop of 40 m² ». A kind may come on
 * two lines (the rented S+2 and the free ones). Nothing here invents a number:
 * a line is what the seller said, or it is dropped.
 *
 * Pure, so the tests can pin every word.
 */
import type { Lang } from "./levels";

export const UNITS_KEY = "units";
/** The category that asks it, and that is sold, never let (a whole building is not a rental). */
export const BUILDING_SLUG = "immeubles";

export const HOME_UNIT_TYPES = ["studio", "s1", "s2", "s3", "s4"] as const;
export const OTHER_UNIT_TYPES = ["shop", "office", "garage"] as const;
export const UNIT_TYPES = [...HOME_UNIT_TYPES, ...OTHER_UNIT_TYPES] as const;
export type UnitType = (typeof UNIT_TYPES)[number];
export type UnitHome = (typeof HOME_UNIT_TYPES)[number];

export const UNIT_STATUSES = ["rented", "free"] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

export type BuildingUnit = {
  type: UnitType;
  count: number;
  /** m² of one of them, when said. */
  area: number | null;
  status: UnitStatus | null;
};

/** Lines a building may hold, and the figures one may carry. */
export const MAX_UNIT_LINES = 8;
export const MAX_UNIT_COUNT = 99;
export const MAX_UNIT_AREA = 5000;
/** The most `attributes` keeps of a text answer (src/lib/listings/input.ts). */
export const UNITS_MAX_LENGTH = 200;

const isType = (v: string): v is UnitType => (UNIT_TYPES as readonly string[]).includes(v);
const isStatus = (v: string): v is UnitStatus => (UNIT_STATUSES as readonly string[]).includes(v);
export const isHomeType = (t: UnitType): t is UnitHome => (HOME_UNIT_TYPES as readonly string[]).includes(t);

function whole(v: string | undefined, min: number, max: number): number | null {
  if (v === undefined || !/^\d{1,5}$/.test(v)) return null;
  const n = Number(v);
  return n >= min && n <= max ? n : null;
}

/**
 * The lines an answer holds, in order. A malformed line (an unknown kind, no
 * count, a count of 0 or 100) is dropped; so is a figure out of its range,
 * keeping the line; what is past the eighth line, or past 200 characters,
 * is not read.
 */
export function parseUnits(raw: unknown): BuildingUnit[] {
  if (typeof raw !== "string") return [];
  const out: BuildingUnit[] = [];
  for (const piece of raw.slice(0, UNITS_MAX_LENGTH).split(";")) {
    if (out.length >= MAX_UNIT_LINES) break;
    const [type, count, area, status] = piece.trim().split(":");
    if (!type || !isType(type)) continue;
    const n = whole(count, 1, MAX_UNIT_COUNT);
    if (n === null) continue;
    out.push({
      type,
      count: n,
      area: whole(area, 1, MAX_UNIT_AREA),
      status: status && isStatus(status) ? status : null,
    });
  }
  return out;
}

/** The answer for these lines; the empty string for none. */
export function serializeUnits(units: readonly BuildingUnit[]): string {
  return units
    .slice(0, MAX_UNIT_LINES)
    .map((u) => {
      const tail = u.status ? `${u.area ?? ""}:${u.status}` : u.area != null ? String(u.area) : "";
      return tail ? `${u.type}:${u.count}:${tail}` : `${u.type}:${u.count}`;
    })
    .join(";");
}

/** What the server keeps of an answer: the lines it can read, written canonically; null when none. */
export function normalizeUnits(raw: unknown): string | null {
  const s = serializeUnits(parseUnits(raw));
  return s === "" ? null : s;
}

/** One more of a kind: the line of that kind with nothing else said grows, else a line is added (when there is room). */
export function addUnit(units: readonly BuildingUnit[], type: UnitType): BuildingUnit[] {
  const plain = units.findIndex((u) => u.type === type && u.area === null && u.status === null);
  if (plain >= 0) return units.map((u, i) => (i === plain ? { ...u, count: Math.min(MAX_UNIT_COUNT, u.count + 1) } : u));
  if (units.length >= MAX_UNIT_LINES) return units.slice();
  return [...units, { type, count: 1, area: null, status: null }];
}

export type UnitTotals = {
  /** Flats and studios. */
  homes: number;
  shops: number;
  offices: number;
  garages: number;
  all: number;
};

export function unitTotals(units: readonly BuildingUnit[]): UnitTotals {
  const sum = (types: readonly UnitType[]) => units.filter((u) => types.includes(u.type)).reduce((n, u) => n + u.count, 0);
  const homes = sum(HOME_UNIT_TYPES);
  const shops = sum(["shop"]);
  const offices = sum(["office"]);
  const garages = sum(["garage"]);
  return { homes, shops, offices, garages, all: homes + shops + offices + garages };
}

/* ── The words ─────────────────────────────────────────────────────────────── */

/** « S+2 » is written in Latin in both languages, isolated so right-to-left does not turn it into « 2+S ». */
const LTR = (s: string) => `⁦${s}⁩`;

const SIZE_WORDS: Record<UnitHome, string> = { studio: "", s1: "S+1", s2: "S+2", s3: "S+3", s4: "S+4" };

/** The kind of one unit, as a line of the table names it: « S+2 », « ستوديو », « محل ». */
export function unitTypeWords(type: UnitType, lang: Lang): string {
  if (type === "s4") return `${LTR("S+4")} ${lang === "ar" ? "وأكثر" : "et plus"}`;
  if (isHomeType(type) && type !== "studio") return LTR(SIZE_WORDS[type]);
  if (type === "studio") return lang === "ar" ? "ستوديو" : "Studio";
  if (type === "shop") return lang === "ar" ? "محل" : "Local commercial";
  if (type === "office") return lang === "ar" ? "مكتب" : "Bureau";
  return lang === "ar" ? "كراج" : "Garage";
}

export function unitStatusWords(status: UnitStatus, lang: Lang): string {
  if (status === "rented") return lang === "ar" ? "مكرية" : "Loué";
  return lang === "ar" ? "فارغة" : "Libre";
}

/** « زوز شقق », « 3 شقق », « 12 شقة », « شقة »: a count of a thing the way Tunisians say it. */
function arCount(n: number, one: string, two: string, few: string, many: string): string {
  if (n === 1) return one;
  if (n === 2) return two;
  return n >= 3 && n <= 10 ? `${n} ${few}` : `${n} ${many}`;
}

const frPlural = (n: number, one: string, many: string) => (n > 1 ? `${n} ${many}` : `${n} ${one}`);

/** « 6 شقق · محل · زوز مكاتب », « 6 appartements · 1 local · 2 bureaux »; the empty string for nothing. */
export function unitsSummary(units: readonly BuildingUnit[], lang: Lang): string {
  const t = unitTotals(units);
  const parts: string[] = [];
  if (lang === "ar") {
    if (t.homes) parts.push(arCount(t.homes, "شقة", "زوز شقق", "شقق", "شقة"));
    if (t.shops) parts.push(arCount(t.shops, "محل", "زوز محلات", "محلات", "محل"));
    if (t.offices) parts.push(arCount(t.offices, "مكتب", "زوز مكاتب", "مكاتب", "مكتب"));
    if (t.garages) parts.push(arCount(t.garages, "كراج", "زوز كراجات", "كراجات", "كراج"));
  } else {
    if (t.homes) parts.push(frPlural(t.homes, "appartement", "appartements"));
    if (t.shops) parts.push(frPlural(t.shops, "local commercial", "locaux commerciaux"));
    if (t.offices) parts.push(frPlural(t.offices, "bureau", "bureaux"));
    if (t.garages) parts.push(frPlural(t.garages, "garage", "garages"));
  }
  return parts.join(" · ");
}

/** The flats and studios alone, for the card: « 6 شقق », « 6 appartements »; the empty string when none. */
export function homesSummary(units: readonly BuildingUnit[], lang: Lang): string {
  const homes = unitTotals(units).homes;
  if (homes === 0) return "";
  return lang === "ar" ? arCount(homes, "شقة", "زوز شقق", "شقق", "شقة") : frPlural(homes, "appartement", "appartements");
}

/**
 * What the `units` question shows where one line of text is wanted (the comparer,
 * the console): the totals, then each line. null to show nothing, undefined for
 * any other question (the caller formats that one as before).
 */
export function unitsFact(key: string, attrs: Readonly<Record<string, unknown>>, lang: Lang): string | null | undefined {
  if (key !== UNITS_KEY) return undefined;
  const units = parseUnits(attrs[UNITS_KEY]);
  if (units.length === 0) return null;
  return `${unitsSummary(units, lang)} — ${units.map((u) => unitLineWords(u, lang)).join(lang === "ar" ? "، " : ", ")}`;
}

/** « 4 × S+2 · 95 م² · مكرية » — one line of the table in a sentence (the description, the admin drawer). */
export function unitLineWords(u: BuildingUnit, lang: Lang): string {
  const sqm = lang === "ar" ? "م²" : "m²";
  return [
    `${u.count} × ${unitTypeWords(u.type, lang)}`,
    u.area != null ? `${u.area} ${sqm}` : null,
    u.status ? unitStatusWords(u.status, lang) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
