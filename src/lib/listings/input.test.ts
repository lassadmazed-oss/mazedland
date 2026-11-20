import { describe, it, expect } from "vitest";
import { attributeOutOfBounds, saneAttributes } from "./input";

describe("saneAttributes — an immeuble (0232)", () => {
  it("writes the building's lines canonically and drops what does not read", () => {
    expect(saneAttributes({ units: " s2:4 ; nope ; s3:2:90 " }).units).toBe("s2:4;s3:2:90");
    expect("units" in saneAttributes({ units: "4 appartements S+2" })).toBe(false);
    expect("units" in saneAttributes({ units: 42 })).toBe(false);
    expect("units" in saneAttributes({ units: "" })).toBe(false);
  });

  it("keeps the other answers as before", () => {
    expect(saneAttributes({ area_sqm: "333", titled: true, units: "shop:1" })).toEqual({ area_sqm: 333, titled: true, units: "shop:1" });
  });

  it("holds the rents an immeuble brings in to a real figure", () => {
    expect(attributeOutOfBounds("rent_income", 2400)).toBe(false);
    expect(attributeOutOfBounds("rent_income", 0)).toBe(true);
    expect(attributeOutOfBounds("rent_income", -5)).toBe(true);
    expect(saneAttributes({ rent_income: "2400" }).rent_income).toBe(2400);
  });
});
