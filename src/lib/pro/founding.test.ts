import { describe, it, expect } from "vitest";
import { foundingPlanFor, foundingPlansOf, seatsOf } from "./founding";

describe("foundingPlansOf", () => {
  const products = [
    { slug: "pro-starter", name_fr: "Starter", name_ar: null, price: 29, listing_quota: 10 },
    { slug: "pro-pro", name_fr: "Pro", name_ar: "برو", price: "59", listing_quota: 40 },
    { slug: "pro-business", name_fr: "Business", name_ar: null, price: 119, listing_quota: 120 },
    { slug: "pro-empty", name_fr: "Vide", name_ar: null, price: 0, listing_quota: 0 },
  ];

  it("offers the chosen plans, in the console's order", () => {
    expect(foundingPlansOf(products, ["pro-pro", "pro-business"]).map((p) => [p.slug, p.quota, p.price])).toEqual([
      ["pro-pro", 40, 59],
      ["pro-business", 120, 119],
    ]);
    expect(foundingPlansOf(products, ["pro-business", "pro-pro"]).map((p) => p.slug)).toEqual(["pro-business", "pro-pro"]);
  });

  it("skips a slug not on sale, one with no quota, blanks and repeats", () => {
    expect(foundingPlansOf(products, ["pro-gold", " PRO-PRO ", "pro-pro", "", "pro-empty"]).map((p) => p.slug)).toEqual(["pro-pro"]);
    expect(foundingPlansOf(products, [])).toEqual([]);
  });
});

describe("foundingPlanFor", () => {
  it("gives the plan the agence picked, else the offer's own", () => {
    expect(foundingPlanFor("pro-business", "pro-pro")).toBe("pro-business");
    expect(foundingPlanFor(null, "pro-pro")).toBe("pro-pro");
    expect(foundingPlanFor("  ", "pro-pro")).toBe("pro-pro");
  });
});

describe("seatsOf", () => {
  it("counts what is left", () => {
    expect(seatsOf(3, 10)).toEqual({ total: 10, taken: 3, left: 7 });
    expect(seatsOf(0, 10)).toEqual({ total: 10, taken: 0, left: 10 });
  });

  it("shows no place left once every one is taken, even when the console gave more", () => {
    expect(seatsOf(10, 10)).toEqual({ total: 10, taken: 10, left: 0 });
    expect(seatsOf(13, 10)).toEqual({ total: 10, taken: 10, left: 0 });
  });

  it("never goes negative on odd settings", () => {
    expect(seatsOf(-2, 10)).toEqual({ total: 10, taken: 0, left: 10 });
    expect(seatsOf(2, 0)).toEqual({ total: 0, taken: 0, left: 0 });
  });
});
