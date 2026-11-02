import { describe, it, expect } from "vitest";
import { cellOf, governorateSlug, marketCacheKey, percentChange, shapeMarket, type MarketRaw, type PriceRow } from "./stats";

const row = (p: Partial<PriceRow> & { deal: PriceRow["deal"] }): PriceRow => ({
  gov: null, cat: null, n: 0, priced_n: 0, median: null, sqm_n: 0, sqm_median: null, recent_n: 0, recent_median: null, prev_n: 0, prev_median: null,
  ...p,
});

/** The live database on 2026-11-01, as 0207 returned it with a sample of 5: 14 annonces, all in Sfax. */
function raw(over: Partial<MarketRaw> = {}): MarketRaw {
  return {
    generated_at: "2026-11-01T19:07:46.826Z",
    window_days: 30,
    min_sample: 5,
    headline: { online: 14, sale: 12, rent: 2, new_recent: 20, new_prev: 12, agences: 7, governorates: 1 },
    categories: [
      { slug: "appartements", label_fr: "Appartements", label_ar: "شقق", kind: "residential" },
      { slug: "terrain", label_fr: "Terrains", label_ar: "أراضي", kind: "land" },
      { slug: "maisons", label_fr: "Maisons", label_ar: "منازل", kind: "residential" },
      { slug: "villas", label_fr: "Villas", label_ar: null, kind: "residential" },
    ],
    prices: [
      row({ deal: "sale", n: 12, priced_n: 12, median: 230000, sqm_n: 0, sqm_median: null, recent_n: 17, recent_median: 210000, prev_n: 12, prev_median: 150000 }),
      row({ deal: "rent", n: 2, priced_n: 0, recent_n: 1 }),
      row({ deal: "sale", cat: "maisons", n: 4, priced_n: 4, median: null, sqm_n: 4, sqm_median: null, recent_n: 6, recent_median: 215000 }),
      row({ deal: "sale", cat: "terrain", n: 4, priced_n: 4, median: null, sqm_n: 4, recent_n: 4, prev_n: 12, prev_median: 150000 }),
      row({ deal: "sale", cat: "appartements", n: 2, priced_n: 2, sqm_n: 2, recent_n: 2 }),
      row({ deal: "rent", cat: "appartements", n: 2 }),
      // A trend-only row: published in the window, nothing online now.
      row({ deal: "rent", cat: "terrain", n: 0, recent_n: 1 }),
      row({ deal: "sale", gov: "Sfax", n: 12, priced_n: 12, median: 230000, recent_n: 17, recent_median: 210000, prev_n: 12, prev_median: 150000 }),
      row({ deal: "rent", gov: "Sfax", n: 2, recent_n: 1 }),
      row({ deal: "sale", gov: "Sfax", cat: "maisons", n: 4, priced_n: 4, sqm_n: 4, recent_n: 6, recent_median: 215000 }),
      row({ deal: "sale", gov: "Sfax", cat: "terrain", n: 4, priced_n: 4, sqm_n: 4, recent_n: 4, prev_n: 12, prev_median: 150000 }),
      row({ deal: "sale", gov: "Sfax", cat: "appartements", n: 2, priced_n: 2, sqm_n: 2, recent_n: 2 }),
      row({ deal: "rent", gov: "Sfax", cat: "appartements", n: 2 }),
    ],
    bands: [
      { deal: "sale", band: 1, n: 1 }, { deal: "sale", band: 3, n: 4 }, { deal: "sale", band: 4, n: 4 }, { deal: "sale", band: 5, n: 1 }, { deal: "sale", band: 6, n: 2 },
    ],
    governorates: [{ gov: "Sfax", online: 14, sale: 12, rent: 2 }],
    demand: { searches: null, visits: null, demandes: 9, by_governorate: [{ gov: "Sfax", searches: null, visits: null, demandes: 6 }] },
    ...over,
  };
}

describe("the minimum-sample rule", () => {
  it("keeps a null median null however many annonces the count says", () => {
    // SQL left the median null (4 < 5): the cell shows the count and no figure.
    const c = cellOf(row({ deal: "sale", cat: "maisons", n: 4, priced_n: 4, median: null }));
    expect(c.median).toEqual({ value: null, n: 4 });
    expect(c.sqm).toEqual({ value: null, n: 0 });
    expect(c.trend.delta).toBeNull();
  });

  it("computes a change only when both sides passed the sample", () => {
    expect(percentChange(210000, 150000)).toBe(40);
    expect(percentChange(150000, 200000)).toBe(-25);
    expect(percentChange(210000, null)).toBeNull();
    expect(percentChange(null, 150000)).toBeNull();
    expect(percentChange(100, 0)).toBeNull();
    // The gated prev median (12 annonces) with a gated recent one (4 < 5): no change shown.
    const c = cellOf(row({ deal: "sale", cat: "terrain", n: 4, priced_n: 4, recent_n: 4, recent_median: null, prev_n: 12, prev_median: 150000 }));
    expect(c.trend.prev.value).toBe(150000);
    expect(c.trend.recent.value).toBeNull();
    expect(c.trend.delta).toBeNull();
  });

  it("shows a demand figure only where SQL left one, and no block when none passed", () => {
    const v = shapeMarket(raw(), "fr");
    expect(v.demand.searches).toBeNull();
    expect(v.demand.visits).toBeNull();
    expect(v.demand.demandes).toBe(9);
    expect(v.demand.any).toBe(true);
    expect(v.governorates[0].demand).toEqual({ searches: null, visits: null, demandes: 6 });

    const none = shapeMarket(raw({ demand: { searches: null, visits: null, demandes: null, by_governorate: [{ gov: "Sfax", searches: null, visits: null, demandes: null }] } }), "fr");
    expect(none.demand.any).toBe(false);
    expect(none.demand.byGovernorate).toEqual([]);
    expect(none.governorates[0].demand).toBeNull();
  });

  it("leaves the price bands out while the deal lacks the sample", () => {
    const v = shapeMarket(raw(), "fr");
    expect(v.bands.sale).toEqual([1, 0, 4, 4, 1, 2]);
    expect(v.bands.rent).toBeNull();
  });
});

describe("shaping the page", () => {
  it("reads the headline, the site-wide prices and the trend", () => {
    const v = shapeMarket(raw(), "fr");
    expect(v.headline.online).toBe(14);
    expect(v.headline.newDelta).toBe(67);
    expect(v.all.sale.median).toEqual({ value: 230000, n: 12 });
    // Never a price per m² across categories (a field and a flat are not one market).
    expect(v.all.sale.sqm.value).toBeNull();
    expect(v.all.sale.trend).toEqual({ recent: { value: 210000, n: 17 }, prev: { value: 150000, n: 12 }, delta: 40 });
    expect(v.all.rent.median).toEqual({ value: null, n: 0 });
  });

  it("orders the categories by supply and labels them in the reader's language", () => {
    const fr = shapeMarket(raw(), "fr");
    expect(fr.categories.map((c) => `${c.slug}:${c.online}`)).toEqual(["appartements:4", "terrain:4", "maisons:4", "villas:0"]);
    expect(fr.categories[0].sale.n).toBe(2);
    expect(fr.categories[0].rent.n).toBe(2);
    const ar = shapeMarket(raw(), "ar");
    expect(ar.categories.map((c) => c.label)).toEqual(["شقق", "أراضي", "منازل", "Villas"]);
  });

  it("gives each governorate its anchor, its categories with annonces and its own prices", () => {
    const v = shapeMarket(raw(), "fr");
    expect(v.governorates).toHaveLength(1);
    const sfax = v.governorates[0];
    expect(sfax.slug).toBe("sfax");
    expect(sfax.online).toBe(14);
    expect(sfax.saleCount).toBe(12);
    expect(sfax.sale.median.value).toBe(230000);
    expect(sfax.categories.map((c) => c.slug)).toEqual(["appartements", "terrain", "maisons"]);
    expect(sfax.rent.median).toEqual({ value: null, n: 0 });
  });

  it("drops governorates without an annonce online and sorts the rest by supply", () => {
    const v = shapeMarket(raw({ governorates: [{ gov: "Tunis", online: 0, sale: 0, rent: 0 }, { gov: "Sousse", online: 3, sale: 3, rent: 0 }, { gov: "Sfax", online: 14, sale: 12, rent: 2 }] }), "fr");
    expect(v.governorates.map((g) => g.gov)).toEqual(["Sfax", "Sousse"]);
  });

  it("survives an aggregation with nothing in it", () => {
    const v = shapeMarket(raw({ prices: [], bands: [], governorates: [], categories: [], demand: { searches: null, visits: null, demandes: null, by_governorate: [] } }), "fr");
    expect(v.all.sale.median).toEqual({ value: null, n: 0 });
    expect(v.categories).toEqual([]);
    expect(v.governorates).toEqual([]);
    expect(v.bands).toEqual({ sale: null, rent: null });
    expect(v.demand.any).toBe(false);
  });
});

describe("anchors and keys", () => {
  it("makes an anchor out of a governorate's name", () => {
    expect(governorateSlug("Sfax")).toBe("sfax");
    expect(governorateSlug("Médenine")).toBe("medenine");
    expect(governorateSlug("Ben Arous")).toBe("ben-arous");
    expect(governorateSlug("Sidi Bouzid")).toBe("sidi-bouzid");
    expect(governorateSlug("Béja")).toBe("beja");
    expect(governorateSlug("Gabès")).toBe("gabes");
  });

  it("keys the cache on the sample and the window", () => {
    expect(marketCacheKey(5, 30)).toBe("public_market:v1:min=5:win=30");
    expect(marketCacheKey(10, 30)).not.toBe(marketCacheKey(5, 30));
  });
});
