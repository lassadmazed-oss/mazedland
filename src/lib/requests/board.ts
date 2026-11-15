/**
 * « Ce que les gens cherchent » (/demandes, the owner, 2026-11-15): the open
 * demandes, shown to everyone, so a buyer sees he is not alone in asking and an
 * agency that is not on Mazed yet sees what the market wants — and comes to
 * offer it.
 *
 * What is public, and why only that (the owner chose « numbers now, cards
 * later »):
 * - TOTALS, for every open demande that asked for alerts: how many, where, what
 *   kind. A count names nobody.
 * - A CARD per demande (what, where, budget, rooms, surface) only for those
 *   saved from `requests_board_cards_since` on: the form said until then that
 *   « only Pro agencies see your criteria », and a demande keeps the promise it
 *   was made under. Never the name, the number, the note, the drawn zone or the
 *   move-in date.
 *
 * Pure, so the rules are tested once; the page reads the rows.
 */

/** The columns the board may read: nothing that says who, nothing typed freely. */
export const BOARD_COLUMNS = "id, deal_type, category_ids, governorates, budget_min, budget_max, surface_min, rooms_min, furnished, created_at";

export type BoardRow = {
  id: string;
  deal_type: string;
  category_ids: string[] | null;
  governorates: string[] | null;
  budget_min: number | string | null;
  budget_max: number | string | null;
  surface_min: number | string | null;
  rooms_min: number | null;
  furnished: string | null;
  created_at: string;
};

export type BoardDeal = "sale" | "rent";

export type BoardTotals = {
  total: number;
  sale: number;
  rent: number;
  /** Each governorate a demande names counts it once; `null` = anywhere in Tunisia. Most asked first. */
  byGovernorate: { governorate: string | null; count: number }[];
  /** Per offer and kind of property; `categoryId` null = any kind. Most asked first. */
  byKind: { deal: BoardDeal; categoryId: string | null; count: number }[];
};

export type BoardCard = {
  id: string;
  deal: BoardDeal;
  categoryIds: string[];
  governorates: string[];
  budgetMin: number | null;
  budgetMax: number | null;
  surfaceMin: number | null;
  roomsMin: number | null;
  /** Rentals only: « meublé », « vide »… as the form stores it. */
  furnished: string | null;
  createdAt: string;
};

const dealOf = (v: string): BoardDeal => (v === "rent" ? "rent" : "sale");
const num = (v: number | string | null): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function boardTotals(rows: readonly BoardRow[]): BoardTotals {
  const gov = new Map<string | null, number>();
  const kind = new Map<string, { deal: BoardDeal; categoryId: string | null; count: number }>();
  let sale = 0;
  let rent = 0;
  for (const r of rows) {
    const deal = dealOf(r.deal_type);
    if (deal === "rent") rent++;
    else sale++;
    const places = [...new Set(r.governorates ?? [])];
    for (const g of places.length ? places : [null]) gov.set(g, (gov.get(g) ?? 0) + 1);
    const cats = [...new Set(r.category_ids ?? [])];
    for (const c of cats.length ? cats : [null]) {
      const key = `${deal}:${c ?? ""}`;
      const k = kind.get(key) ?? { deal, categoryId: c, count: 0 };
      k.count++;
      kind.set(key, k);
    }
  }
  // Most asked first; « anywhere » and « any kind » after the named ones at the same count.
  const byGovernorate = [...gov].map(([governorate, count]) => ({ governorate, count }))
    .sort((a, b) => b.count - a.count || Number(a.governorate === null) - Number(b.governorate === null) || String(a.governorate).localeCompare(String(b.governorate)));
  const byKind = [...kind.values()]
    .sort((a, b) => b.count - a.count || Number(a.categoryId === null) - Number(b.categoryId === null) || a.deal.localeCompare(b.deal));
  return { total: rows.length, sale, rent, byGovernorate, byKind };
}

/** A moment the console may type: an ISO date or date-time, else nothing. */
export function boardSince(raw: string | null | undefined): number | null {
  const v = (raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * The cards everyone may see: demandes saved from `since` on (the form said so
 * then), newest first, at most `max`. No moment set, no card.
 */
export function boardCards(rows: readonly BoardRow[], sinceRaw: string | null | undefined, max = 24): BoardCard[] {
  const since = boardSince(sinceRaw);
  if (since === null) return [];
  return rows
    .filter((r) => Date.parse(r.created_at) >= since)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, Math.max(0, max))
    .map((r) => {
      const deal = dealOf(r.deal_type);
      return {
        id: r.id,
        deal,
        categoryIds: [...new Set(r.category_ids ?? [])],
        governorates: [...new Set(r.governorates ?? [])],
        budgetMin: num(r.budget_min),
        budgetMax: num(r.budget_max),
        surfaceMin: num(r.surface_min),
        roomsMin: r.rooms_min != null && r.rooms_min > 0 ? r.rooms_min : null,
        furnished: deal === "rent" ? r.furnished : null,
        createdAt: r.created_at,
      };
    });
}

/** Whether the totals are worth showing: under `min` open demandes, the board keeps quiet. */
export function boardShown(total: number, min: number): boolean {
  return total >= Math.max(1, min);
}
