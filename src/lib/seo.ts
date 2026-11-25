/**
 * What search engines read about a page (« SEO sur le téléphone », cahier
 * P5): its address of record, its other-language twin, whether it belongs in
 * an index, and the structured data Google turns into rich results.
 *
 * Pure, so the rules are tested once. Paths are without the locale (« /annonces »,
 * « » for the home); the locale is added here.
 */
import { routing } from "@/i18n/routing";

type Alternates = { canonical: string; languages: Record<string, string> };

/**
 * The page's canonical address and its twin in every locale. Every public page
 * sets its own: the layout's pair named the home page, so /fr/annonces told
 * Google its Arabic version was /ar.
 */
export function pageAlternates(locale: string, path: string, query = ""): Alternates {
  const q = query ? `?${query}` : "";
  return {
    canonical: `/${locale}${path}${q}`,
    languages: {
      ...Object.fromEntries(routing.locales.map((l) => [l, `/${l}${path}${q}`])),
      "x-default": `/${routing.defaultLocale}${path}${q}`,
    },
  };
}

/** The catalogue filters that make a page of its own: « Appartements à louer à Sfax ». */
const LANDING = ["deal", "cat", "gov", "del", "page"] as const;
/** Carried by links and forms, saying nothing about the results. */
const NEUTRAL = new Set(["via", "utm_source", "utm_medium", "utm_campaign", "utm_content", "fbclid", "gclid"]);

/**
 * Which catalogue addresses belong in an index. A city, a type, sale or rent,
 * and their pages are landing pages; a keyword, a budget, a sort or any other
 * filter makes a results page — followed, not indexed, with the landing page
 * it narrows as its canonical. Otherwise every price range would be a page.
 */
export function catalogueIndexing(sp: Readonly<Record<string, string | undefined>>): { query: string; index: boolean } {
  const kept = new URLSearchParams();
  for (const k of LANDING) {
    const v = sp[k]?.trim();
    if (!v) continue;
    if (k === "page" && (!/^\d+$/.test(v) || v === "1")) continue;
    if (k === "deal" && v !== "sale" && v !== "rent") continue;
    if (k === "del" && !sp.gov?.trim()) continue;
    kept.set(k, v);
  }
  const narrowed = Object.entries(sp).some(([k, v]) => !!v?.trim() && !(LANDING as readonly string[]).includes(k) && !NEUTRAL.has(k));
  return { query: kept.toString(), index: !narrowed };
}

/**
 * The landing pages worth listing in the sitemap, from the published annonces:
 * every city, type, city + type, and each of those for sale or for rent, that
 * holds at least one. Written in the order `catalogueIndexing` keeps, so the
 * sitemap and the canonical name the same address.
 */
export function catalogueLandings(rows: readonly { deal: string | null; cat: string | null; gov: string | null }[]): string[] {
  const out = new Set<string>();
  for (const r of rows) {
    const deals = r.deal === "sale" || r.deal === "rent" ? [null, r.deal] : [null];
    for (const deal of deals) {
      for (const cat of r.cat ? [null, r.cat] : [null]) {
        for (const gov of r.gov ? [null, r.gov] : [null]) {
          const q = new URLSearchParams();
          if (deal) q.set("deal", deal);
          if (cat) q.set("cat", cat);
          if (gov) q.set("gov", gov);
          // The bare catalogue is already listed as /annonces.
          if (q.size > 0) out.add(q.toString());
        }
      }
    }
  }
  return Array.from(out).sort();
}

/** Cut at a word, under `max` characters, with an ellipsis when cut. */
export function clip(text: string, max = 160): string {
  const s = text.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.·—-]+$/, "")}…`;
}

/**
 * A seller's words made fit for a search snippet or structured data: no emoji
 * or pictograph (a snippet shows them as boxes, and « 📍💰🗒 » are a third of
 * some descriptions), and no phone number — the number is behind « Afficher le
 * numéro » on the page (logged, rate-limited); a crawler and the scrapers that
 * read its output do not get it for free. A price, a surface or a year is kept:
 * a Tunisian number is 8 digits starting 2–9, not followed by a currency or a unit.
 */
export function seoText(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu, " ")
    .replace(/(?<![\d+])(?:\+?216[\s.-]?)?[2-9]\d(?:[\s.-]?\d){6}(?![\d])(?!\s*(?:dt|tnd|d\.t|د\.?ت|dinars?|m²|m2|م²|م2|mille|ألف|الف))/giu, " ")
    .replace(/\s+/g, " ")
    // A comma or a full stop left alone after a removed number; « : » keeps its French space.
    .replace(/\s+([,.،])/g, "$1")
    .trim();
}

/**
 * An annonce's search snippet. The facts lead — what, how big, where, how
 * much — in one line every annonce shares, so a reader (and an answer engine)
 * finds them in the same place; the seller's own words follow, cleaned.
 */
export function listingDescription(description: string | null | undefined, facts: string): string {
  const own = seoText(description);
  const lead = facts.replace(/[.\s]+$/, "");
  return clip(own ? `${lead}. ${own}` : `${lead}.`);
}

/**
 * An annonce's <title>, from its facts rather than the seller's title (which is
 * often in capitals, with emoji, and 120 characters long): « Appartement S+1 à
 * louer à El Mourouj 6 (Ben Arous) · 850 TND / mois ». The seller's title stays
 * the page's h1. `what` is empty when the category is unknown: then the
 * seller's title, cleaned and cut, is the what.
 */
export function listingSeoTitle(
  lang: "fr" | "ar",
  p: { what: string; deal: "sale" | "rent"; place: string; price: string; fallback: string },
): string {
  const what = p.what.trim() || clip(seoText(p.fallback), 50);
  const deal = lang === "ar" ? (p.deal === "rent" ? "للكراء" : "للبيع") : p.deal === "rent" ? "à louer" : "à vendre";
  const where = p.place ? (lang === "ar" ? ` في ${p.place}` : ` à ${p.place}`) : "";
  return `${what} ${deal}${where} · ${p.price}`;
}

/** « El Mourouj 6 (Ben Arous) », or the governorate alone when the délégation says the same or nothing. */
export function placeWords(delegation: string | null | undefined, governorate: string | null | undefined): string {
  const del = (delegation ?? "").trim();
  const gov = (governorate ?? "").trim();
  if (del && gov && del.toLowerCase() !== gov.toLowerCase()) return `${del} (${gov})`;
  return del || gov;
}

// ── Structured data (schema.org) ────────────────────────────────────────────

export function breadcrumbLd(items: readonly { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: it.url })),
  };
}

/** The site, with the search Google can offer under its result (sitelinks search box). */
export function websiteLd(origin: string, locale: string, name: string) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name,
    url: `${origin}/${locale}`,
    inLanguage: locale,
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${origin}/${locale}/annonces?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
}

export function organizationLd(origin: string, name: string, opts: { whatsapp?: string; email?: string; sameAs?: readonly string[] }) {
  const phone = opts.whatsapp?.replace(/[^\d+]/g, "");
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name,
    url: origin,
    logo: `${origin}/logo-square.png`,
    // The same Mazed on Facebook, Instagram, TikTok: one entity to a search or an answer engine, not four.
    ...(opts.sameAs && opts.sameAs.length > 0 ? { sameAs: [...opts.sameAs] } : {}),
    ...(phone || opts.email
      ? { contactPoint: [{ "@type": "ContactPoint", contactType: "customer service", areaServed: "TN", availableLanguage: ["fr", "ar"], ...(phone ? { telephone: phone } : {}), ...(opts.email ? { email: opts.email } : {}) }] }
      : {}),
  };
}

/** A guide (0208), as Google reads an article: who wrote it, when, in which language. */
export function articleLd(input: {
  url: string;
  headline: string;
  description: string;
  image?: string | null;
  datePublished: string;
  dateModified: string;
  inLanguage: string;
  publisher: string;
  origin: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    mainEntityOfPage: input.url,
    headline: input.headline,
    description: input.description,
    ...(input.image ? { image: [input.image] } : {}),
    datePublished: input.datePublished,
    dateModified: input.dateModified,
    inLanguage: input.inLanguage,
    author: { "@type": "Organization", name: input.publisher, url: input.origin },
    publisher: {
      "@type": "Organization",
      name: input.publisher,
      logo: { "@type": "ImageObject", url: `${input.origin}/logo-square.png` },
    },
  };
}

/** The annonces a catalogue page shows, in order. */
export function itemListLd(urls: readonly string[]) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: urls.map((url, i) => ({ "@type": "ListItem", position: i + 1, url })),
  };
}
