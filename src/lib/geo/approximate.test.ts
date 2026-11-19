import { describe, expect, it } from "vitest";
import { GOVERNORATE_SPREAD_M, QUARTIER_SPREAD_M, approximatePoint } from "./approximate";
import { GOVERNORATE_CENTER, distanceM } from "./location";
import { delegationCenter } from "./places";
import { quartiersOf } from "./quartier";

describe("approximatePoint", () => {
  it("puts an annonce with a délégation around that délégation", () => {
    const at = approximatePoint("Sfax", "Kerkennah", "a1")!;
    expect(distanceM(at, delegationCenter("Sfax", "Kerkennah")!)).toBeLessThanOrEqual(701);
  });

  it("puts one without a délégation around its governorate: Tunis in Tunis, Ariana in Ariana", () => {
    for (const gov of ["Tunis", "Ariana", "Sousse", "Zaghouan"]) {
      const at = approximatePoint(gov, null, `no-del-${gov}`)!;
      expect(distanceM(at, GOVERNORATE_CENTER[gov])).toBeLessThanOrEqual(GOVERNORATE_SPREAD_M + 1);
    }
  });

  it("treats a délégation the map does not know like none", () => {
    const at = approximatePoint("Gabès", "Chatt El Arbi", "x")!;
    expect(distanceM(at, GOVERNORATE_CENTER["Gabès"])).toBeLessThanOrEqual(GOVERNORATE_SPREAD_M + 1);
  });

  it("puts one whose address names a quartier around that quartier", () => {
    const at = approximatePoint("Sousse", null, "q1", "Sousse , Sahloul")!;
    const sahloul = quartiersOf("Sousse", "Hammam Sousse").find((q) => q[0] === "Sahloul")!;
    expect(distanceM(at, { lat: sahloul[2], lng: sahloul[3] })).toBeLessThanOrEqual(QUARTIER_SPREAD_M + 1);
    // An address that names nothing known keeps the délégation's centre.
    expect(distanceM(approximatePoint("Sfax", "Kerkennah", "a1", "près de la mer")!, delegationCenter("Sfax", "Kerkennah")!)).toBeLessThanOrEqual(701);
  });

  it("is the same point for an annonce every time, and nothing for an unknown governorate", () => {
    expect(approximatePoint("Tunis", null, "same")).toEqual(approximatePoint("Tunis", null, "same"));
    expect(approximatePoint("Atlantis", null, "x")).toBeNull();
  });
});
