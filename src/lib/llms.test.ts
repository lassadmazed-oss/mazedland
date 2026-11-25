import { describe, it, expect } from "vitest";
import { buildLlmsTxt, type LlmsInput } from "./llms";

const base: LlmsInput = {
  origin: "https://www.mazed.immo",
  listings: [
    { deal: "sale", cat: "appartements", gov: "Sfax" },
    { deal: "sale", cat: "appartements", gov: "Sfax" },
    { deal: "rent", cat: "appartements", gov: "Tunis" },
    { deal: "sale", cat: "terrain", gov: "Sfax" },
  ],
  categories: { appartements: "Appartements", terrain: "Terrains" },
  agencies: 36,
  guides: [{ slug: "acheter", title: "Acheter un bien en Tunisie" }],
  marketPage: true,
  demandsPage: false,
  whatsapp: "+216 58 415 510",
  email: "contact@mazed.immo",
};

describe("buildLlmsTxt", () => {
  const txt = buildLlmsTxt(base);

  it("starts the way llmstxt.org asks: a title, then a quoted summary, in French and in Arabic", () => {
    expect(txt.startsWith("# Mazed Immo\n\n> Mazed Immo (mazed.immo)")).toBe(true);
    expect(txt).toContain("> مزاد إيمو");
  });

  it("says only what the published annonces hold", () => {
    expect(txt).toContain("- 4 annonces en ligne : 3 à vendre, 1 à louer, dans 2 gouvernorats");
    expect(txt).toContain("- 36 agences et promoteurs");
  });

  it("lists the searches with the most annonces, as catalogue links", () => {
    expect(txt).toContain("- [Appartements à vendre à Sfax](https://www.mazed.immo/fr/annonces?deal=sale&cat=appartements&gov=Sfax) : 2 annonces");
    expect(txt).toContain("- [Biens à Sfax](https://www.mazed.immo/fr/annonces?gov=Sfax) : 3 annonces");
    const first = txt.indexOf("## Recherches fréquentes");
    expect(txt.indexOf("Biens à Sfax", first)).toBeLessThan(txt.indexOf("Appartements à vendre à Sfax", first));
  });

  it("names a page only when it is on, and the guides by title", () => {
    expect(txt).toContain("/fr/marche");
    expect(txt).not.toContain("/fr/demandes");
    expect(txt).toContain("- [Acheter un bien en Tunisie](https://www.mazed.immo/fr/guides/acheter)");
    expect(buildLlmsTxt({ ...base, guides: [] })).not.toContain("## Guides");
  });

  it("never carries a seller's number, and ends with the sitemap", () => {
    expect(txt).toContain("Le numéro du vendeur n'est pas dans la page");
    expect(txt.trimEnd().endsWith("- [Plan du site](https://www.mazed.immo/sitemap.xml)")).toBe(true);
  });
});
