import { describe, expect, it } from "vitest";
import { findQuartier, quartiersOf, quartiersOfGovernorate } from "./quartier";

describe("quartiers", () => {
  it("lists a délégation's quartiers, however the délégation was typed", () => {
    const names = quartiersOf("Sousse", "hammam sousse").map((q) => q[0]);
    expect(names).toContain("Sahloul");
    expect(quartiersOf("Sousse", "Atlantis")).toEqual([]);
    expect(quartiersOfGovernorate("Ariana").some(({ delegation, q }) => delegation === "La Soukra" && q[0] === "Borj Louzir")).toBe(true);
  });

  it("finds the quartier the sellers wrote, with its délégation", () => {
    // Addresses as they are on the live annonces (2026-11-12).
    expect(findQuartier("Sousse", null, "Sousse , Sahloul")?.delegation).toBe("Hammam Sousse");
    expect(findQuartier("Ariana", null, "Borj Louzir — La Soukra")).toMatchObject({ delegation: "La Soukra", fr: "Borj Louzir" });
    expect(findQuartier("Ariana", null, "Cité El Ghazela")?.delegation).toBe("Raoued");
    expect(findQuartier("Nabeul", null, "Mrezga")).toMatchObject({ delegation: "Hammamet", fr: "El Mrezga" });
    expect(findQuartier("Tunis", null, "Mutuelleville")?.delegation).toBe("El Menzah");
    expect(findQuartier("Tunis", null, "Tunis , Marsa, cite les pins")).toMatchObject({ delegation: "La Marsa", fr: "Cité Les Pins" });
  });

  it("prefers the longest name the address holds", () => {
    expect(findQuartier("Nabeul", null, "Nabeul Hammamet Nord , Mrezga")?.fr).toBe("Hammamet Nord");
  });

  it("reads Arabic as well", () => {
    expect(findQuartier("Sousse", null, "سهلول، سوسة")?.fr).toBe("Sahloul");
  });

  it("keeps to the annonce's délégation when it has one", () => {
    expect(findQuartier("Sousse", "Sousse Riadh", "Sahloul")).toBeNull();
    expect(findQuartier("Sousse", "Hammam Sousse", "Sahloul")?.fr).toBe("Sahloul");
  });

  it("finds nothing in nothing", () => {
    expect(findQuartier("Sousse", null, "")).toBeNull();
    expect(findQuartier(null, null, "Sahloul")).toBeNull();
    expect(findQuartier("Sfax", null, "Route saltnia klm 8,5")).toBeNull();
  });
});
