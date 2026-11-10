import { describe, it, expect } from "vitest";
import { demandeVia, requestFormFromSearch, requestHrefFromListing, roundBudgetUp } from "./prefill";

const LAND = { id: "6f1d6a2e-3b7c-4d2a-9a51-0c9b1f2e7a10", slug: "terrain" };
const FLAT = { id: "9b3c1e47-5a2d-4f8e-b6c0-2d4e6f8a0b12", slug: "appartements" };
const cats = [FLAT, LAND];

describe("requestFormFromSearch", () => {
  it("keeps the words searched, in « Autres souhaits »", () => {
    const out = requestFormFromSearch({ q: "  Teniour  " }, cats);
    expect(out.words).toBe("Teniour");
    expect(out.value.note).toBe("Teniour");
  });

  it("turns every filter the demande knows into a criterion", () => {
    const out = requestFormFromSearch(
      { deal: "sale", cat: "terrain", gov: "Sfax", min: "50000", max: "120000", surface: "300", rooms: "2", q: "route de Teniour" },
      cats,
    );
    expect(out).toEqual({
      value: {
        deal_type: "sale",
        category_ids: [LAND.id],
        governorates: ["Sfax"],
        budget_min: "50000",
        budget_max: "120000",
        surface_min: "300",
        rooms_min: "2",
        furnished: "",
        move_in_by: "",
        note: "route de Teniour",
        alerts: true,
        zone: null,
      },
      words: "route de Teniour",
      anyDeal: false,
    });
  });

  it("keeps the rental questions for a rental only", () => {
    const rent = requestFormFromSearch({ deal: "rent", furnished: "furnished", avail: "2026-12-01", max: "900" }, cats);
    expect([rent.value.furnished, rent.value.move_in_by]).toEqual(["furnished", "2026-12-01"]);
    const sale = requestFormFromSearch({ deal: "sale", furnished: "furnished", avail: "2026-12-01" }, cats);
    expect([sale.value.furnished, sale.value.move_in_by]).toEqual(["", ""]);
  });

  it("reads a category by id as well as by slug", () => {
    expect(requestFormFromSearch({ cat: FLAT.id }, cats).value.category_ids).toEqual([FLAT.id]);
    expect(requestFormFromSearch({ cat: "chateaux" }, cats).value.category_ids).toEqual([]);
  });

  it("drops what is not real: an unknown place, a bad number, a bad date", () => {
    const out = requestFormFromSearch(
      { deal: "rent", gov: "Atlantis", min: "-5", max: "abc", surface: "0", rooms: "40", avail: "2026-02-31" },
      cats,
    );
    expect(out.value).toMatchObject({
      governorates: [],
      budget_min: "",
      budget_max: "",
      surface_min: "",
      rooms_min: "",
      move_in_by: "",
    });
  });

  it("flags a search over sales and rentals, not a blank form", () => {
    expect(requestFormFromSearch({ q: "Teniour" }, cats).anyDeal).toBe(true);
    expect(requestFormFromSearch({ gov: "Sfax", deal: "rent" }, cats).anyDeal).toBe(false);
    expect(requestFormFromSearch({}, cats)).toMatchObject({ anyDeal: false, words: null });
  });
});

describe("demandeVia", () => {
  it("keeps the places the site offers a demande from, and nothing else", () => {
    expect(demandeVia("top")).toBe("top");
    expect(demandeVia("listing")).toBe("listing");
    expect(demandeVia("evil<script>")).toBeNull();
    expect(demandeVia("")).toBeNull();
    expect(demandeVia(undefined)).toBeNull();
  });
});

describe("roundBudgetUp", () => {
  it("rounds up to two significant digits, never below the amount", () => {
    expect(roundBudgetUp(316_250)).toBe(320_000);
    expect(roundBudgetUp(825)).toBe(830);
    expect(roundBudgetUp(1_595)).toBe(1_600);
    expect(roundBudgetUp(300_000)).toBe(300_000);
    expect(roundBudgetUp(55)).toBe(55);
    expect(roundBudgetUp(7)).toBe(7);
  });

  it("gives 0 for nothing to round", () => {
    expect(roundBudgetUp(0)).toBe(0);
    expect(roundBudgetUp(-5)).toBe(0);
    expect(roundBudgetUp(Number.NaN)).toBe(0);
  });
});

describe("requestHrefFromListing", () => {
  const params = (href: string) => Object.fromEntries(new URL(href, "https://x.test").searchParams);

  it("starts from the annonce: deal, type, governorate, price plus the margin", () => {
    const href = requestHrefFromListing(
      { deal: "sale", categorySlug: "villas", governorate: "Sfax", price: 287_500, priceOnRequest: false },
      10,
    );
    expect(href.startsWith("/demandes/nouvelle?")).toBe(true);
    expect(params(href)).toEqual({ deal: "sale", cat: "villas", gov: "Sfax", max: "320000", via: "listing" });
  });

  it("opens on the same criteria the form reads from a search", () => {
    const href = requestHrefFromListing(
      { deal: "rent", categorySlug: "terrain", governorate: "Sfax", price: 750, priceOnRequest: false },
      0,
    );
    const out = requestFormFromSearch(params(href), cats);
    expect(out.value.deal_type).toBe("rent");
    expect(out.value.category_ids).toEqual([LAND.id]);
    expect(out.value.governorates).toEqual(["Sfax"]);
    expect(out.value.budget_max).toBe("750");
    expect(out.words).toBeNull();
  });

  it("sets no budget when the price is on request or missing", () => {
    expect(params(requestHrefFromListing({ deal: "sale", categorySlug: null, governorate: "Tunis", price: 400_000, priceOnRequest: true }, 10)).max).toBeUndefined();
    expect(params(requestHrefFromListing({ deal: "sale", categorySlug: null, governorate: "Tunis", price: null, priceOnRequest: false }, 10)).max).toBeUndefined();
  });

  it("leaves out an unknown governorate", () => {
    expect(params(requestHrefFromListing({ deal: "sale", categorySlug: null, governorate: "Atlantis", price: 1000, priceOnRequest: false }, 10)).gov).toBeUndefined();
  });
});
