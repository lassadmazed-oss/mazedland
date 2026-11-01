import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pairStarters, parseStarter, starterFileName, starterRow } from "./starter";
import { readStarterGuides } from "./starterServer";
import { canPublish, isArticleSlug } from "./articles";
import { outline, parseMarkdown, plainText, wordCount } from "./markdown";

const DIR = path.join(process.cwd(), "docs", "guides");

describe("a starter file", () => {
  it("is named <slug>.<fr|ar>.md", () => {
    expect(starterFileName("promesse-de-vente.fr.md")).toEqual({ slug: "promesse-de-vente", lang: "fr" });
    expect(starterFileName("promesse-de-vente.ar.md")).toEqual({ slug: "promesse-de-vente", lang: "ar" });
    expect(starterFileName("README.md")).toBeNull();
    expect(starterFileName("Promesse.fr.md")).toBeNull();
  });

  it("reads its header and body", () => {
    const f = parseStarter("x-y.fr.md", "---\ntitle: Un titre\nexcerpt: Deux phrases.\ntags: acheter, juridique\n---\n\n## A\n\nTexte.\n");
    expect(f).toEqual({
      slug: "x-y",
      lang: "fr",
      title: "Un titre",
      excerpt: "Deux phrases.",
      tags: ["acheter", "juridique"],
      seoTitle: null,
      seoDescription: null,
      body: "## A\n\nTexte.",
    });
  });

  it("refuses what the table would refuse, with the file's name", () => {
    expect(() => parseStarter("x-y.fr.md", "no front matter")).toThrow(/front matter/);
    expect(() => parseStarter("x-y.fr.md", "---\nexcerpt: e\n---\nbody")).toThrow(/no title/);
    expect(() => parseStarter("x-y.fr.md", "---\ntitle: t\ntags: nope\n---\nbody")).toThrow(/unknown tag/);
    expect(() => parseStarter("x-y.fr.md", "---\ntitle: t\n---\n")).toThrow(/empty body/);
    expect(() => parseStarter("x-y.fr.md", "---\ntitle: t\nweird line\n---\nbody")).toThrow(/bad header line/);
  });

  it("pairs the two languages of one slug and makes a draft row of them", () => {
    const fr = parseStarter("a-b.fr.md", "---\ntitle: T\ntags: acheter\n---\nbody fr");
    const ar = parseStarter("a-b.ar.md", "---\ntitle: ع\ntags: acheter, juridique\n---\nbody ar");
    const [g] = pairStarters([ar, fr]);
    expect(g).toMatchObject({ slug: "a-b", tags: ["acheter", "juridique"] });
    expect(starterRow(g)).toMatchObject({ slug: "a-b", status: "draft", source_key: "a-b", title_fr: "T", title_ar: "ع", body_ar: "body ar" });
  });
});

describe("docs/guides", () => {
  const guides = readStarterGuides(DIR);

  it("holds the ten guides, each in French and in Arabic", () => {
    expect(guides).toHaveLength(10);
    for (const g of guides) {
      expect(isArticleSlug(g.slug), g.slug).toBe(true);
      expect(g.fr, `${g.slug}.fr`).not.toBeNull();
      expect(g.ar, `${g.slug}.ar`).not.toBeNull();
      expect(g.fr!.tags, `${g.slug} tags agree`).toEqual(g.ar!.tags);
      expect(g.tags.length, `${g.slug} has tags`).toBeGreaterThan(0);
      expect(g.fr!.excerpt, `${g.slug}.fr excerpt`).toBeTruthy();
      expect(g.ar!.excerpt, `${g.slug}.ar excerpt`).toBeTruthy();
    }
  });

  it("names no file the import would not read", () => {
    const stray = readdirSync(DIR).filter((n) => n !== "README.md" && starterFileName(n) === null);
    expect(stray).toEqual([]);
  });

  it("makes rows the console could publish as they are", () => {
    for (const g of guides) expect(canPublish({ ...starterRow(g), slug: g.slug }), g.slug).toBe(true);
  });

  it("is written in sections, long enough to be a guide, with no HTML and no phone number", () => {
    for (const g of guides) {
      for (const f of [g.fr!, g.ar!]) {
        const blocks = parseMarkdown(f.body);
        const headings = outline(blocks);
        expect(headings.length, `${g.slug}.${f.lang} sections`).toBeGreaterThanOrEqual(4);
        expect(wordCount(plainText(blocks)), `${g.slug}.${f.lang} words`).toBeGreaterThan(300);
        expect(f.body, `${g.slug}.${f.lang} html`).not.toMatch(/<[a-z!/][^>]*>/i);
        expect(f.body, `${g.slug}.${f.lang} phone`).not.toMatch(/(?:\+216|00216)?[\s.-]?\d{2}[\s.-]?\d{3}[\s.-]?\d{3}\b/);
      }
    }
  });

  it("links only to guides that exist", () => {
    const slugs = new Set(guides.map((g) => g.slug));
    for (const g of guides) {
      for (const f of [g.fr!, g.ar!]) {
        for (const m of f.body.matchAll(/\]\(\/guides\/([a-z0-9-]+)\)/g)) {
          expect(slugs.has(m[1]), `${g.slug}.${f.lang} → ${m[1]}`).toBe(true);
        }
      }
    }
  });

  it("marks the figures that change as to be checked", () => {
    // Fees, rates and commissions move with the finance law: every guide that
    // speaks of them says so, in its own language.
    const money = guides.filter((g) => /frais|credit|promoteur|agence|location/.test(g.slug));
    for (const g of money) {
      expect(g.fr!.body, `${g.slug}.fr`).toMatch(/vérifi|changent|négoci/i);
      expect(g.ar!.body, `${g.slug}.ar`).toMatch(/تثبّت|تتغيّر|تفاوض|يُفاوَض|قابل للتفاوض/);
    }
    const raw = readFileSync(path.join(DIR, "frais-de-notaire-et-droits-d-enregistrement.fr.md"), "utf8");
    // No bare percentage stated as a fact in the fees guide.
    expect(raw).not.toMatch(/\d+\s?%/);
  });
});
