/**
 * The console's one search box (the owner, 2026-11-04: « ديما نعمل ريشيرش خير
 * من نرجع نلوّج ») — the pure parts.
 *
 * One term goes to every section the member may open, and each hit links to
 * the screen that changes it, already opened on that row (`?a=<id>`, or the
 * agences' `?id=`). The console's pages and the settings are matched in the
 * browser from their labels; the rows come from /api/admin/search.
 */
import type { ConsoleSection } from "./sections";

export const SEARCH_MIN_CHARS = 2;
export const SEARCH_MAX_CHARS = 60;
/** Rows per source: enough to tell them apart, few enough to read. */
export const SEARCH_LIMIT = 5;

/** Where the API looks, in the order the box lists them. */
export const SEARCH_SOURCES = [
  "listings", "shops", "sellers", "payments", "invoices", "social", "ads", "products", "articles", "categories",
] as const;
export type SearchSource = (typeof SEARCH_SOURCES)[number];

/** The section each source belongs to: a member sees only their own sections' rows. */
export const SOURCE_SECTION: Record<SearchSource, ConsoleSection> = {
  listings: "annonces",
  shops: "agences",
  sellers: "vendeurs",
  payments: "paiements",
  invoices: "paiements",
  social: "social",
  ads: "publicites",
  products: "offres",
  articles: "content",
  categories: "catalogue",
};

/** One row found: what it is, a line to tell it from its neighbours, where it is changed. */
export type SearchHit = { id: string; title: string; meta: string[]; href: string };
export type SearchGroup = { source: SearchSource; hits: SearchHit[] };

/**
 * The term as PostgREST's `or()` can take it: the characters that delimit its
 * filter string (and the wildcards) leave, or they change the query.
 */
export function cleanTerm(raw: string): string {
  return raw.slice(0, SEARCH_MAX_CHARS).replace(/[,()*%"\\]/g, " ").replace(/\s+/g, " ").trim();
}

/** An annonce's reference as typed off a note: « 1643 », « mz-1643 », « MZ 01643 » → MZ-01643. */
export function listingRefFor(q: string): string | null {
  const m = /^(?:mz[\s_-]*)?0*(\d{1,5})$/i.exec(q.trim());
  return m ? `MZ-${m[1].padStart(5, "0")}` : null;
}

/**
 * The digits of a phone number, when the term is one: « 98 124 111 » or
 * « +216 98124111 », not « MZ-01643 » or « villa 3 », whose digits would match
 * any number holding them.
 */
export function phoneDigits(q: string): string | null {
  if (/[a-z؀-ۿ]/i.test(q)) return null;
  const digits = q.replace(/\D/g, "");
  return digits.length >= 3 ? digits : null;
}

/** A social request's reference, shown « MZ-91A470 »: six hex characters. */
export function socialRefFor(q: string): string | null {
  const m = /^(?:mz[\s_-]*)?([0-9a-f]{6})$/i.exec(q.trim());
  return m ? m[1].toUpperCase() : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string) => UUID.test(v);

// ── Links ────────────────────────────────────────────────────────────────────

const qs = (params: Record<string, string | null | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  return p.toString();
};

/**
 * Each link opens the row's own panel, on a tab that holds it (« Toutes ») and,
 * where the list is searched, with a term that keeps it in view.
 */
export const searchHref = {
  listing: (id: string, reference: string | null) => `/admin/annonces?${qs({ status: "all", q: reference, a: id })}`,
  shop: (id: string) => `/admin/agences?${qs({ status: "all", id })}`,
  seller: (id: string, phone: string | null) => `/admin/vendeurs?${qs({ q: phone, a: id })}`,
  // The first eight characters of the id are the reference on the transfer
  // (src/lib/payments/search.ts): the list keeps that one payment.
  payment: (id: string) => `/admin/paiements?${qs({ status: "all", q: id.slice(0, 8), a: id })}`,
  social: (status: string) =>
    status === "pending_approval" ? "/admin/social" : status === "published" ? "/admin/social?tab=publies" : "/admin/social?tab=file",
  ad: (id: string) => `/admin/publicites?${qs({ a: id })}`,
  product: (id: string) => `/admin/offres?${qs({ a: id })}`,
  article: (id: string) => `/admin/contenu?${qs({ a: id })}`,
  category: (id: string) => `/admin/catalogue?${qs({ a: id })}`,
  setting: (group: string, key: string) => `/admin/settings?${qs({ g: group, k: key })}`,
};

// ── Matching labels in the browser ──────────────────────────────────────────

/**
 * A text as the box compares it: no case, no accents, and the Arabic letters
 * people write either way taken as one (أ إ آ ا, ة ه, ى ي, no tashkeel or
 * tatweel) — « reglage » finds « Réglages », « اعلان » finds « إعلان ».
 */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\u0640/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * How well a label answers the words typed: 0 when one word is missing, more
 * when the words are in the label itself than only in its hint, and most
 * when the label starts with them.
 */
export function labelScore(query: string, label: string, extra = ""): number {
  const words = fold(query).split(" ").filter(Boolean);
  if (!words.length) return 0;
  const l = fold(label);
  const all = `${l} ${fold(extra)}`;
  if (!words.every((w) => all.includes(w))) return 0;
  const inLabel = words.filter((w) => l.includes(w)).length;
  return 1 + inLabel * 2 + (l.startsWith(words[0]) ? 3 : 0);
}
