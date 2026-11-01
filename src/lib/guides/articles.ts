/**
 * Guides (0208): what an article is, what the console may write into one,
 * which language a page shows, and which guides belong beside an annonce.
 *
 * Pure — no database, no React — so the console's routes, the public pages
 * and the strips apply the same rules, tested once.
 */
import type { DealType } from "@/lib/listings/deal";

export const ARTICLE_STATUSES = ["draft", "published"] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

export type ArticleLang = "fr" | "ar";
export const ARTICLE_LANGS: readonly ArticleLang[] = ["fr", "ar"];

/**
 * What a guide is about, as chips in the editor (never typed). The first
 * eight say what the reader is doing; the last four say what kind of
 * property — they are also how a guide is matched to an annonce
 * (`guidesForListing`): a guide tagged « louer » is shown beside rentals, one
 * tagged « terrain » beside plots.
 */
export const ARTICLE_TAGS = [
  "acheter",
  "vendre",
  "louer",
  "financement",
  "juridique",
  "promoteur",
  "annonce",
  "securite",
  "appartement",
  "maison",
  "terrain",
  "professionnel",
] as const;
export type ArticleTag = (typeof ARTICLE_TAGS)[number];

export function isArticleTag(v: unknown): v is ArticleTag {
  return typeof v === "string" && (ARTICLE_TAGS as readonly string[]).includes(v);
}

/** A row of `articles`, as the console and the pages read it. */
export type Article = {
  id: string;
  slug: string;
  status: ArticleStatus;
  published_at: string | null;
  cover_path: string | null;
  title_fr: string | null;
  title_ar: string | null;
  excerpt_fr: string | null;
  excerpt_ar: string | null;
  body_fr: string | null;
  body_ar: string | null;
  tags: string[];
  seo_title_fr: string | null;
  seo_title_ar: string | null;
  seo_description_fr: string | null;
  seo_description_ar: string | null;
  author_id: string | null;
  source_key: string | null;
  created_at: string;
  updated_at: string;
};

/** What a card or a strip needs: no body. */
export type ArticleSummary = Pick<
  Article,
  "id" | "slug" | "status" | "published_at" | "updated_at" | "cover_path" | "title_fr" | "title_ar" | "excerpt_fr" | "excerpt_ar" | "tags"
>;

/** The table's own limits (0208), so the console says which field is too long. */
export const ARTICLE_LIMITS = {
  slug: 80,
  title: 160,
  excerpt: 400,
  body: 60000,
  seoTitle: 120,
  seoDescription: 300,
  tags: 8,
} as const;

/** The console's advice for the search snippet: Google shows about this much. */
export const SEO_ADVICE = { title: 60, description: 160 } as const;

// ─── The slug ───────────────────────────────────────────────────────────────

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isArticleSlug(v: unknown): v is string {
  return typeof v === "string" && v.length >= 3 && v.length <= ARTICLE_LIMITS.slug && SLUG.test(v);
}

/**
 * The guide's address from its French title: « Acheter un bien : les étapes »
 * → acheter-un-bien-les-etapes. Accents are folded, anything else becomes a
 * dash. Empty when the title has no Latin letters or digits (an Arabic title):
 * the editor then asks for one.
 */
export function slugFromTitle(title: string): string {
  const s = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, ARTICLE_LIMITS.slug)
    .replace(/-+$/g, "");
  return s.length >= 3 ? s : "";
}

/** `articles/<uuid>.<ext>` — the only paths the console mints for a cover. */
export function isArticleCoverPath(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^articles\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/.test(v)
  );
}

export const ARTICLE_COVER = {
  /** The card and the page show it at 16:9; 1600 × 900 is plenty. */
  width: 1600,
  height: 900,
  maxBytes: 4 * 1024 * 1024,
} as const;

export const ARTICLE_COVER_EXTS = ["jpg", "png", "webp"] as const;
export type ArticleCoverExt = (typeof ARTICLE_COVER_EXTS)[number];

/** The extension a cover is stored under, from the file's name or type. */
export function articleCoverExt(nameOrType: string): ArticleCoverExt | null {
  const s = nameOrType.toLowerCase().trim();
  const ext = s.includes("/") ? s.split("/").pop()! : s.split(".").pop()!;
  if (ext === "jpg" || ext === "jpeg") return "jpg";
  if (ext === "png" || ext === "webp") return ext;
  return null;
}

// ─── Languages ──────────────────────────────────────────────────────────────

export type LangState = "complete" | "partial" | "empty";

type LangFields = Pick<Article, "title_fr" | "title_ar" | "body_fr" | "body_ar">;

const has = (v: string | null | undefined) => typeof v === "string" && v.trim().length > 0;

/** Whether a language has its title and its body, one of them, or nothing. */
export function langState(a: LangFields, lang: ArticleLang): LangState {
  const title = has(lang === "fr" ? a.title_fr : a.title_ar);
  const body = has(lang === "fr" ? a.body_fr : a.body_ar);
  if (title && body) return "complete";
  if (title || body) return "partial";
  return "empty";
}

/** A guide may go online once one language is whole. */
export function canPublish(a: LangFields & { slug: string }): boolean {
  return isArticleSlug(a.slug) && (langState(a, "fr") === "complete" || langState(a, "ar") === "complete");
}

export type Shown = {
  /** The language the text is in. */
  lang: ArticleLang;
  /** True when it is not the page's language: the page says so. */
  missing: boolean;
  title: string;
  excerpt: string | null;
  body: string;
  seoTitle: string | null;
  seoDescription: string | null;
};

/**
 * The text a page in `locale` shows: its own language when that is whole,
 * else the other one with `missing` set, so the reader is told the guide is
 * not translated yet rather than shown nothing.
 */
export function shownText(a: Article, locale: string): Shown | null {
  const want: ArticleLang = locale === "ar" ? "ar" : "fr";
  const other: ArticleLang = want === "ar" ? "fr" : "ar";
  const lang = langState(a, want) === "complete" ? want : langState(a, other) === "complete" ? other : null;
  if (!lang) return null;
  return {
    lang,
    missing: lang !== want,
    title: (lang === "fr" ? a.title_fr : a.title_ar)!.trim(),
    excerpt: (lang === "fr" ? a.excerpt_fr : a.excerpt_ar)?.trim() || null,
    body: (lang === "fr" ? a.body_fr : a.body_ar)!,
    seoTitle: (lang === "fr" ? a.seo_title_fr : a.seo_title_ar)?.trim() || null,
    seoDescription: (lang === "fr" ? a.seo_description_fr : a.seo_description_ar)?.trim() || null,
  };
}

/** A card's title and excerpt in the page's language, falling back to the other. */
export function summaryText(a: ArticleSummary, locale: string): { title: string; excerpt: string | null; lang: ArticleLang; missing: boolean } {
  const want: ArticleLang = locale === "ar" ? "ar" : "fr";
  const other: ArticleLang = want === "ar" ? "fr" : "ar";
  const lang = has(want === "fr" ? a.title_fr : a.title_ar) ? want : other;
  return {
    lang,
    missing: lang !== want,
    title: ((lang === "fr" ? a.title_fr : a.title_ar) ?? "").trim(),
    excerpt: (lang === "fr" ? a.excerpt_fr : a.excerpt_ar)?.trim() || null,
  };
}

// ─── What the console may write ─────────────────────────────────────────────

export type ArticleWrite = Partial<
  Pick<
    Article,
    | "slug"
    | "cover_path"
    | "title_fr"
    | "title_ar"
    | "excerpt_fr"
    | "excerpt_ar"
    | "body_fr"
    | "body_ar"
    | "tags"
    | "seo_title_fr"
    | "seo_title_ar"
    | "seo_description_fr"
    | "seo_description_ar"
  >
>;

/** The field that is wrong — each has a sentence in `adminContent.api`. */
export type ArticleInputError = "slug" | "title" | "excerpt" | "body" | "tags" | "seo" | "cover";

export type ArticleInputResult = { ok: true; value: ArticleWrite } | { ok: false; error: ArticleInputError };

/** Trimmed text, `null` for empty, `undefined` for too long or not text. */
function text(v: unknown, max: number, keepLines = false): string | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return undefined;
  const s = keepLines ? v.replace(/\r\n?/g, "\n").replace(/^\s+|\s+$/g, "") : v.trim().replace(/\s+/g, " ");
  if (!s) return null;
  return s.length <= max ? s : undefined;
}

/**
 * The console's form, checked field by field. `partial` is the PATCH: only the
 * fields sent are read. The slug is read on creation only — a guide's address
 * does not move once it exists (links, the sitemap, Google).
 */
export function parseArticleInput(body: Record<string, unknown>, { partial }: { partial: boolean }): ArticleInputResult {
  const out: ArticleWrite = {};
  const sent = (k: string) => !partial || k in body;

  if (!partial) {
    if (!isArticleSlug(body.slug)) return { ok: false, error: "slug" };
    out.slug = body.slug;
  }
  for (const lang of ARTICLE_LANGS) {
    const title = `title_${lang}` as const;
    const excerpt = `excerpt_${lang}` as const;
    const bodyKey = `body_${lang}` as const;
    const seoT = `seo_title_${lang}` as const;
    const seoD = `seo_description_${lang}` as const;
    if (sent(title)) {
      const v = text(body[title], ARTICLE_LIMITS.title);
      if (v === undefined) return { ok: false, error: "title" };
      out[title] = v;
    }
    if (sent(excerpt)) {
      const v = text(body[excerpt], ARTICLE_LIMITS.excerpt);
      if (v === undefined) return { ok: false, error: "excerpt" };
      out[excerpt] = v;
    }
    if (sent(bodyKey)) {
      const v = text(body[bodyKey], ARTICLE_LIMITS.body, true);
      if (v === undefined) return { ok: false, error: "body" };
      out[bodyKey] = v;
    }
    if (sent(seoT)) {
      const v = text(body[seoT], ARTICLE_LIMITS.seoTitle);
      if (v === undefined) return { ok: false, error: "seo" };
      out[seoT] = v;
    }
    if (sent(seoD)) {
      const v = text(body[seoD], ARTICLE_LIMITS.seoDescription);
      if (v === undefined) return { ok: false, error: "seo" };
      out[seoD] = v;
    }
  }
  if (sent("tags")) {
    const raw = body.tags;
    if (raw === undefined || raw === null) out.tags = [];
    else if (!Array.isArray(raw) || !raw.every(isArticleTag)) return { ok: false, error: "tags" };
    else {
      const tags = ARTICLE_TAGS.filter((t) => (raw as string[]).includes(t));
      if (tags.length > ARTICLE_LIMITS.tags) return { ok: false, error: "tags" };
      out.tags = [...tags];
    }
  }
  if (sent("cover_path")) {
    const v = body.cover_path;
    if (v === null || v === undefined || v === "") out.cover_path = null;
    else if (isArticleCoverPath(v)) out.cover_path = v;
    else return { ok: false, error: "cover" };
  }
  return { ok: true, value: out };
}

// ─── Beside an annonce ──────────────────────────────────────────────────────

/** The guide tag a category's slug speaks to. */
export const TAG_FOR_CATEGORY: Readonly<Record<string, ArticleTag>> = {
  appartements: "appartement",
  maisons: "maison",
  villas: "maison",
  terrain: "terrain",
  fermes: "terrain",
  "locaux-commerciaux": "professionnel",
  bureaux: "professionnel",
  depots: "professionnel",
};

export const TAG_FOR_DEAL: Readonly<Record<DealType, ArticleTag>> = { sale: "acheter", rent: "louer" };

const DEAL_TAGS = new Set<ArticleTag>(["acheter", "louer"]);

export type ListingContext = { deal?: DealType | null; categorySlug?: string | null };

/**
 * Which guides to show beside an annonce or a catalogue page, best first:
 * the ones about what the reader is doing (buying or renting) count most,
 * then the ones about this kind of property; among equals the newest. A guide
 * about the other deal alone (buying, on a rental) is left out; a guide about
 * neither (safety, photos) fills the remaining places. Never more than `count`.
 */
export function guidesForListing<T extends Pick<ArticleSummary, "tags" | "published_at">>(
  guides: readonly T[],
  ctx: ListingContext,
  count: number,
): T[] {
  if (count <= 0) return [];
  const dealTag = ctx.deal ? TAG_FOR_DEAL[ctx.deal] : null;
  const typeTag = ctx.categorySlug ? TAG_FOR_CATEGORY[ctx.categorySlug] ?? null : null;
  const scored = guides
    .map((g, index) => {
      const tags = new Set(g.tags);
      const aboutDeal = dealTag ? tags.has(dealTag) : false;
      const aboutOther = dealTag ? [...tags].some((t) => DEAL_TAGS.has(t as ArticleTag) && t !== dealTag) : false;
      if (dealTag && aboutOther && !aboutDeal) return null;
      const score = (aboutDeal ? 4 : 0) + (typeTag && tags.has(typeTag) ? 2 : 0);
      return { g, score, index, at: g.published_at ? Date.parse(g.published_at) : 0 };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.score - a.score || b.at - a.at || a.index - b.index);
  return scored.slice(0, count).map((x) => x.g);
}

/**
 * Related guides at the end of a guide: the ones sharing the most tags,
 * then the newest. The guide itself is never among them.
 */
export function relatedGuides<T extends Pick<ArticleSummary, "id" | "tags" | "published_at">>(
  guides: readonly T[],
  current: Pick<ArticleSummary, "id" | "tags">,
  count: number,
): T[] {
  if (count <= 0) return [];
  const mine = new Set(current.tags);
  return guides
    .filter((g) => g.id !== current.id)
    .map((g, index) => ({ g, shared: g.tags.filter((t) => mine.has(t)).length, index, at: g.published_at ? Date.parse(g.published_at) : 0 }))
    .sort((a, b) => b.shared - a.shared || b.at - a.at || a.index - b.index)
    .slice(0, count)
    .map((x) => x.g);
}

export type GuideCta = "publish" | "rent" | "buy";

/**
 * Where the band at the end of a guide sends the reader: to publish when the
 * guide is for sellers, to the rentals when it is about renting, to the
 * catalogue otherwise.
 */
export function ctaFor(tags: readonly string[]): GuideCta {
  if (tags.includes("vendre") || tags.includes("annonce")) return "publish";
  if (tags.includes("louer") && !tags.includes("acheter")) return "rent";
  return "buy";
}

export const CTA_HREF: Readonly<Record<GuideCta, string>> = {
  publish: "/annonces/nouvelle",
  rent: "/annonces?deal=rent",
  buy: "/annonces?deal=sale",
};

// ─── The audit trail ────────────────────────────────────────────────────────

const AUDITED = [
  "slug", "status", "published_at", "cover_path", "title_fr", "title_ar", "excerpt_fr", "excerpt_ar",
  "body_fr", "body_ar", "tags", "seo_title_fr", "seo_title_ar", "seo_description_fr", "seo_description_ar",
] as const;

/**
 * A guide as the audit trail keeps it: every field as it is, except the two
 * bodies, which are long — their length and their first line say what
 * changed without storing 60 000 characters twice per save.
 */
export function auditView(row: Partial<Article>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of AUDITED) {
    if (!(k in row)) continue;
    const v = row[k];
    if ((k === "body_fr" || k === "body_ar") && typeof v === "string") {
      out[k] = { chars: v.length, head: v.split("\n").find((l) => l.trim())?.trim().slice(0, 120) ?? "" };
    } else out[k] = v ?? null;
  }
  return out;
}

/** The keys whose audited value differs between two views. */
export function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return Object.keys(after).filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null));
}
