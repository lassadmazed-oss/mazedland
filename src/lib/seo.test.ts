import { describe, expect, it } from "vitest";
import { articleLd, catalogueIndexing, catalogueLandings, clip, itemListLd, listingDescription, listingSeoTitle, organizationLd, pageAlternates, placeWords, seoText, websiteLd } from "./seo";
import { jsonLdSafe } from "./jsonld";

describe("seo", () => {
  it("describes a guide as an article by the site, in its language, safe inside a script", () => {
    const ld = articleLd({
      url: "https://www.mazed.immo/fr/guides/x",
      headline: "Acheter </script> un bien",
      description: "d",
      image: null,
      datePublished: "2026-11-01T10:00:00Z",
      dateModified: "2026-11-02T10:00:00Z",
      inLanguage: "fr",
      publisher: "Mazed Immo",
      origin: "https://www.mazed.immo",
    });
    expect(ld).toMatchObject({ "@type": "Article", inLanguage: "fr", author: { "@type": "Organization", name: "Mazed Immo" } });
    expect(ld).not.toHaveProperty("image");
    expect(jsonLdSafe(ld)).not.toContain("</script>");
    expect(articleLd({ url: "u", headline: "h", description: "d", image: "https://i/x.jpg", datePublished: "a", dateModified: "b", inLanguage: "ar", publisher: "p", origin: "o" })).toMatchObject({ image: ["https://i/x.jpg"] });
  });

  it("names the page itself and its twin, never the home page", () => {
    expect(pageAlternates("ar", "/annonces", "cat=terrains&gov=Sfax")).toEqual({
      canonical: "/ar/annonces?cat=terrains&gov=Sfax",
      languages: { fr: "/fr/annonces?cat=terrains&gov=Sfax", ar: "/ar/annonces?cat=terrains&gov=Sfax", "x-default": "/fr/annonces?cat=terrains&gov=Sfax" },
    });
    expect(pageAlternates("fr", "").canonical).toBe("/fr");
  });

  it("indexes a city, a type, sale or rent, and their pages", () => {
    expect(catalogueIndexing({ cat: "appartements", gov: "Sfax" })).toEqual({ query: "cat=appartements&gov=Sfax", index: true });
    expect(catalogueIndexing({ gov: "Sfax", deal: "rent", page: "2" })).toEqual({ query: "deal=rent&gov=Sfax&page=2", index: true });
    expect(catalogueIndexing({ gov: "Sfax", del: "Sakiet Ezzit" })).toEqual({ query: "gov=Sfax&del=Sakiet+Ezzit", index: true });
    expect(catalogueIndexing({}).query).toBe("");
  });

  it("a keyword, a budget or a sort is a results page: followed, not indexed, canonical to its landing page", () => {
    expect(catalogueIndexing({ cat: "villas", q: "piscine" })).toEqual({ query: "cat=villas", index: false });
    expect(catalogueIndexing({ gov: "Tunis", max: "300000" })).toEqual({ query: "gov=Tunis", index: false });
    expect(catalogueIndexing({ gov: "Tunis", sort: "price_asc" }).index).toBe(false);
  });

  it("ignores what says nothing about the results, and drops what is not a filter", () => {
    expect(catalogueIndexing({ gov: "Sousse", via: "search", utm_source: "fb" })).toEqual({ query: "gov=Sousse", index: true });
    expect(catalogueIndexing({ deal: "all", page: "1", del: "El Ain" })).toEqual({ query: "", index: true });
    expect(catalogueIndexing({ page: "abc" }).query).toBe("");
  });

  it("lists every landing page that holds an annonce, written like the canonical", () => {
    const pages = catalogueLandings([
      { deal: "rent", cat: "appartements", gov: "Sfax" },
      { deal: "sale", cat: "terrains", gov: "Sfax" },
    ]);
    expect(pages).toContain("gov=Sfax");
    expect(pages).toContain("cat=appartements&gov=Sfax");
    expect(pages).toContain("deal=rent&cat=appartements&gov=Sfax");
    expect(pages).toContain("deal=sale");
    expect(pages).not.toContain("deal=sale&cat=appartements");
    expect(pages).not.toContain("");
    for (const q of pages) {
      const sp = Object.fromEntries(new URLSearchParams(q));
      expect(catalogueIndexing(sp).query, q).toBe(q);
    }
  });

  it("cuts a snippet at a word, with an ellipsis", () => {
    expect(clip("court")).toBe("court");
    const long = "Villa avec piscine ".repeat(20);
    const c = clip(long, 60);
    expect(c.length).toBeLessThanOrEqual(60);
    expect(c.endsWith("…")).toBe(true);
    expect(c).not.toMatch(/ …$/);
  });

  it("lets the facts lead, whatever the seller wrote", () => {
    expect(listingDescription("ممتاز", "Appartement · 208 m² · S+4 · Sfax · Prix sur demande")).toBe(
      "Appartement · 208 m² · S+4 · Sfax · Prix sur demande. ممتاز",
    );
    expect(listingDescription(null, "Terrain · Sfax.")).toBe("Terrain · Sfax.");
    const real = "Bel appartement lumineux au 3e étage, cuisine équipée, deux salles d'eau, proche des écoles et du centre.";
    // Since 2026-11-25 the facts lead every snippet, a long description too: one place for them in every result.
    expect(listingDescription(real, "Appartement · Sfax")).toBe(`Appartement · Sfax. ${real}`);
  });

  it("offers Google the site's search, and how to reach the company", () => {
    const w = websiteLd("https://www.mazed.immo", "ar", "Mazed Immo");
    expect(w.potentialAction.target.urlTemplate).toBe("https://www.mazed.immo/ar/annonces?q={search_term_string}");
    const o = organizationLd("https://www.mazed.immo", "Mazed Immo", { whatsapp: "+216 58 415 521" });
    expect(o.contactPoint?.[0].telephone).toBe("+21658415521");
    expect(organizationLd("https://x", "M", {}).contactPoint).toBeUndefined();
    expect(itemListLd(["a", "b"]).itemListElement[1]).toEqual({ "@type": "ListItem", position: 2, url: "b" });
  });

  it("structured data never closes its own script tag", () => {
    const out = jsonLdSafe({ name: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("</script>");
    expect(JSON.parse(out).name).toBe("</script><script>alert(1)</script>");
  });
});

describe("an annonce for search engines (2026-11-25)", () => {
  it("takes emoji and phone numbers out of the seller's words, and keeps prices, surfaces and years", () => {
    expect(seoText("📍Situé au 1er étage 🌟 vue mer")).toBe("Situé au 1er étage vue mer");
    expect(seoText("📞 Contact : 99804057")).toBe("Contact :");
    expect(seoText("Tél 98 124 111 ou +216 22 132 278, WhatsApp 22.13.22.78")).toBe("Tél ou, WhatsApp");
    expect(seoText("Prix : 12 000 000 DT, terrain 1 150 m², construit en 2012")).toBe("Prix : 12 000 000 DT, terrain 1 150 m², construit en 2012");
    expect(seoText("السوم 25000000 د.ت")).toBe("السوم 25000000 د.ت");
    expect(seoText(null)).toBe("");
  });

  it("leads the snippet with the facts, then the cleaned words, under 160 characters", () => {
    const d = listingDescription("🏡 À LOUER – Appartement 📞 99804057 très lumineux", "Appartement · 80 m² · Ben Arous · 850 TND / mois");
    expect(d.startsWith("Appartement · 80 m² · Ben Arous · 850 TND / mois. À LOUER")).toBe(true);
    expect(d).not.toContain("99804057");
    expect(listingDescription("x".repeat(400), "Villa")).toHaveLength(160);
  });

  it("writes the title from the facts, in both languages, the seller's title only when there are none", () => {
    expect(listingSeoTitle("fr", { what: "Appartement S+1", deal: "rent", place: "El Mourouj 6 (Ben Arous)", price: "850 TND / mois", fallback: "x" })).toBe(
      "Appartement S+1 à louer à El Mourouj 6 (Ben Arous) · 850 TND / mois",
    );
    expect(listingSeoTitle("ar", { what: "شقة S+2", deal: "sale", place: "صفاقس", price: "250 000 د.ت", fallback: "x" })).toBe("شقة S+2 للبيع في صفاقس · 250 000 د.ت");
    expect(listingSeoTitle("fr", { what: "", deal: "sale", place: "", price: "Prix sur demande", fallback: "🏡 BELLE VILLA 📞 98124111" })).toBe("BELLE VILLA à vendre · Prix sur demande");
  });

  it("names the place once when the délégation is the governorate", () => {
    expect(placeWords("El Mourouj", "Ben Arous")).toBe("El Mourouj (Ben Arous)");
    expect(placeWords("Sfax", "Sfax")).toBe("Sfax");
    expect(placeWords(null, "Sousse")).toBe("Sousse");
    expect(placeWords("", "")).toBe("");
  });

  it("ties the organisation to its social accounts", () => {
    expect(organizationLd("https://www.mazed.immo", "Mazed Immo", { sameAs: ["https://www.facebook.com/mazedonline"] })).toMatchObject({ sameAs: ["https://www.facebook.com/mazedonline"] });
    expect(organizationLd("https://www.mazed.immo", "Mazed Immo", {})).not.toHaveProperty("sameAs");
  });
});
