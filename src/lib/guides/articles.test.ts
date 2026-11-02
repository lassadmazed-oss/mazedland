import { describe, expect, it } from "vitest";
import {
  ARTICLE_TAGS,
  TAG_FOR_CATEGORY,
  auditView,
  canPublish,
  changedKeys,
  ctaFor,
  guidesForListing,
  isArticleCoverPath,
  isArticleSlug,
  langState,
  parseArticleInput,
  relatedGuides,
  shownText,
  slugFromTitle,
  summaryText,
  type Article,
  type ArticleSummary,
} from "./articles";

const base: Article = {
  id: "a1",
  slug: "acheter-un-bien",
  status: "draft",
  published_at: null,
  cover_path: null,
  title_fr: "Acheter un bien",
  title_ar: null,
  excerpt_fr: "Les étapes.",
  excerpt_ar: null,
  body_fr: "## Étapes\n\nTexte.",
  body_ar: null,
  tags: ["acheter"],
  seo_title_fr: null,
  seo_title_ar: null,
  seo_description_fr: null,
  seo_description_ar: null,
  author_id: null,
  source_key: null,
  created_at: "2026-11-01T10:00:00Z",
  updated_at: "2026-11-01T10:00:00Z",
};

describe("the slug", () => {
  it("comes from the French title, folded and dashed", () => {
    expect(slugFromTitle("Acheter un bien : les étapes")).toBe("acheter-un-bien-les-etapes");
    expect(slugFromTitle("  Frais de notaire & droits d'enregistrement  ")).toBe("frais-de-notaire-droits-d-enregistrement");
    expect(slugFromTitle("شراء عقار")).toBe("");
    expect(slugFromTitle("ab")).toBe("");
  });

  it("is lower-case words joined by single dashes, 3 to 80 characters", () => {
    expect(isArticleSlug("acheter-un-bien")).toBe(true);
    expect(isArticleSlug("guide-2026")).toBe(true);
    expect(isArticleSlug("Acheter")).toBe(false);
    expect(isArticleSlug("a--b")).toBe(false);
    expect(isArticleSlug("-ab")).toBe(false);
    expect(isArticleSlug("ab")).toBe(false);
    expect(isArticleSlug("a".repeat(81))).toBe(false);
    expect(isArticleSlug(slugFromTitle("x".repeat(200)))).toBe(true);
  });

  it("never moves once the guide exists: a PATCH ignores it", () => {
    const r = parseArticleInput({ slug: "autre-adresse", title_fr: "T" }, { partial: true });
    expect(r.ok && "slug" in r.value).toBe(false);
  });
});

describe("languages", () => {
  it("says whether a language is whole, begun or empty", () => {
    expect(langState(base, "fr")).toBe("complete");
    expect(langState(base, "ar")).toBe("empty");
    expect(langState({ ...base, title_ar: "عنوان" }, "ar")).toBe("partial");
    expect(langState({ ...base, body_fr: "   " }, "fr")).toBe("partial");
  });

  it("publishes once one language is whole and the slug valid", () => {
    expect(canPublish(base)).toBe(true);
    expect(canPublish({ ...base, body_fr: null })).toBe(false);
    expect(canPublish({ ...base, body_fr: null, title_ar: "ع", body_ar: "نص" })).toBe(true);
    expect(canPublish({ ...base, slug: "Bad Slug" })).toBe(false);
  });

  it("shows the page's language when whole, else the other with a note", () => {
    expect(shownText(base, "fr")).toMatchObject({ lang: "fr", missing: false, title: "Acheter un bien" });
    expect(shownText(base, "ar")).toMatchObject({ lang: "fr", missing: true });
    const both = { ...base, title_ar: "شراء عقار", body_ar: "نص", seo_title_ar: " عنوان غوغل " };
    expect(shownText(both, "ar")).toMatchObject({ lang: "ar", missing: false, title: "شراء عقار", seoTitle: "عنوان غوغل", excerpt: null });
    expect(shownText({ ...base, body_fr: null }, "fr")).toBeNull();
  });

  it("gives a card its title in the page's language, else the other", () => {
    expect(summaryText(base, "ar")).toMatchObject({ lang: "fr", missing: true, title: "Acheter un bien" });
    expect(summaryText({ ...base, title_ar: "عنوان" }, "ar")).toMatchObject({ lang: "ar", missing: false, title: "عنوان" });
  });
});

describe("parseArticleInput", () => {
  it("reads a whole form, trims and empties to null", () => {
    const r = parseArticleInput(
      { slug: "mon-guide", title_fr: "  Titre  ", excerpt_fr: "", body_fr: "  ## A\r\nTexte  ", tags: ["juridique", "acheter", "acheter"], cover_path: "" },
      { partial: false },
    );
    expect(r).toEqual({
      ok: true,
      value: {
        slug: "mon-guide",
        title_fr: "Titre",
        excerpt_fr: null,
        body_fr: "## A\nTexte",
        title_ar: null,
        excerpt_ar: null,
        body_ar: null,
        seo_title_fr: null,
        seo_description_fr: null,
        seo_title_ar: null,
        seo_description_ar: null,
        tags: ["acheter", "juridique"],
        cover_path: null,
      },
    });
  });

  it("names the field that is wrong", () => {
    expect(parseArticleInput({ slug: "Bad" }, { partial: false })).toEqual({ ok: false, error: "slug" });
    expect(parseArticleInput({ title_fr: "x".repeat(161) }, { partial: true })).toEqual({ ok: false, error: "title" });
    expect(parseArticleInput({ excerpt_ar: "x".repeat(401) }, { partial: true })).toEqual({ ok: false, error: "excerpt" });
    expect(parseArticleInput({ body_fr: "x".repeat(60001) }, { partial: true })).toEqual({ ok: false, error: "body" });
    expect(parseArticleInput({ tags: ["nope"] }, { partial: true })).toEqual({ ok: false, error: "tags" });
    expect(parseArticleInput({ tags: "acheter" }, { partial: true })).toEqual({ ok: false, error: "tags" });
    expect(parseArticleInput({ seo_title_fr: "x".repeat(121) }, { partial: true })).toEqual({ ok: false, error: "seo" });
    expect(parseArticleInput({ cover_path: "ads/x.jpg" }, { partial: true })).toEqual({ ok: false, error: "cover" });
    expect(parseArticleInput({ title_fr: 5 }, { partial: true })).toEqual({ ok: false, error: "title" });
  });

  it("reads only what a partial form sends", () => {
    expect(parseArticleInput({ title_ar: "عنوان" }, { partial: true })).toEqual({ ok: true, value: { title_ar: "عنوان" } });
    expect(parseArticleInput({}, { partial: true })).toEqual({ ok: true, value: {} });
  });

  it("accepts only the covers the console mints", () => {
    expect(isArticleCoverPath("articles/0f3b2d4e-1a2b-4c3d-8e9f-0123456789ab.webp")).toBe(true);
    expect(isArticleCoverPath("articles/0f3b2d4e-1a2b-4c3d-8e9f-0123456789ab.gif")).toBe(false);
    expect(isArticleCoverPath("ads/0f3b2d4e-1a2b-4c3d-8e9f-0123456789ab.jpg")).toBe(false);
    expect(isArticleCoverPath("https://x/articles/a.jpg")).toBe(false);
  });
});

const g = (id: string, tags: string[], at: string): ArticleSummary => ({
  id,
  slug: id,
  status: "published",
  published_at: at,
  updated_at: at,
  cover_path: null,
  title_fr: id,
  title_ar: null,
  excerpt_fr: null,
  excerpt_ar: null,
  tags,
});

const pool = [
  g("buy-steps", ["acheter", "juridique"], "2026-10-01T00:00:00Z"),
  g("rent-contract", ["louer", "juridique", "appartement"], "2026-10-05T00:00:00Z"),
  g("land-papers", ["acheter", "terrain"], "2026-10-03T00:00:00Z"),
  g("safety", ["securite"], "2026-10-09T00:00:00Z"),
  g("photos", ["vendre", "annonce"], "2026-10-07T00:00:00Z"),
  g("both", ["acheter", "louer"], "2026-10-02T00:00:00Z"),
];

describe("guidesForListing", () => {
  it("maps every leaf category to a tag", () => {
    for (const slug of ["appartements", "maisons", "villas", "terrain", "fermes", "locaux-commerciaux", "bureaux", "depots"]) {
      expect(ARTICLE_TAGS).toContain(TAG_FOR_CATEGORY[slug]);
    }
  });

  it("puts the guides about this deal and this kind of property first, newest among equals", () => {
    expect(guidesForListing(pool, { deal: "sale", categorySlug: "terrain" }, 3).map((x) => x.id)).toEqual(["land-papers", "both", "buy-steps"]);
    expect(guidesForListing(pool, { deal: "rent", categorySlug: "appartements" }, 3).map((x) => x.id)).toEqual(["rent-contract", "both", "safety"]);
  });

  it("leaves out a guide about the other deal alone, and fills with neutral ones", () => {
    const picked = guidesForListing(pool, { deal: "rent", categorySlug: "villas" }, 6).map((x) => x.id);
    expect(picked).not.toContain("buy-steps");
    expect(picked).not.toContain("land-papers");
    expect(picked).toEqual(["rent-contract", "both", "safety", "photos"]);
  });

  it("with no deal, orders by date and keeps the count", () => {
    expect(guidesForListing(pool, {}, 2).map((x) => x.id)).toEqual(["safety", "photos"]);
    expect(guidesForListing(pool, { deal: "sale" }, 0)).toEqual([]);
  });
});

describe("relatedGuides", () => {
  it("prefers the guides sharing the most tags and never the guide itself", () => {
    const related = relatedGuides(pool, { id: "buy-steps", tags: ["acheter", "juridique"] }, 3).map((x) => x.id);
    expect(related).toEqual(["rent-contract", "land-papers", "both"]);
    expect(related).not.toContain("buy-steps");
    expect(relatedGuides(pool, { id: "x", tags: [] }, 0)).toEqual([]);
  });
});

describe("ctaFor", () => {
  it("sends sellers to publish, renters to the rentals, everyone else to the catalogue", () => {
    expect(ctaFor(["vendre", "annonce"])).toBe("publish");
    expect(ctaFor(["louer", "juridique"])).toBe("rent");
    expect(ctaFor(["acheter", "louer"])).toBe("buy");
    expect(ctaFor(["securite"])).toBe("buy");
  });
});

describe("the audit view", () => {
  it("keeps every field but shortens the bodies to their size and first line", () => {
    const v = auditView({ ...base, body_fr: "\n\n## Étapes\n\nTexte." });
    expect(v.body_fr).toEqual({ chars: 19, head: "## Étapes" });
    expect(v.title_fr).toBe("Acheter un bien");
    expect(v).not.toHaveProperty("author_id");
  });

  it("names the keys that moved", () => {
    const before = auditView(base);
    const after = auditView({ ...base, title_fr: "Autre", tags: ["acheter"] });
    expect(changedKeys(before, after)).toEqual(["title_fr"]);
  });
});
