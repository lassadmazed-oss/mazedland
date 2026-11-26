import { describe, expect, it } from "vitest";
import { governorateFromPlace } from "./placeGovernorate";

describe("governorateFromPlace (Prospection, 2026-11-26)", () => {
  it("finds the governorate of the places the faster model left without one", () => {
    expect(governorateFromPlace("Menzah 5")).toBe("Ariana");
    expect(governorateFromPlace("Chotrana 3")).toBe("Ariana");
    expect(governorateFromPlace("La Marsa Ville")).toBe("Tunis");
    expect(governorateFromPlace("Manar 1")).toBe("Tunis");
  });

  it("reads a délégation, and says nothing for nothing", () => {
    expect(governorateFromPlace("Hammamet")).toBe("Nabeul");
    expect(governorateFromPlace("")).toBeNull();
    expect(governorateFromPlace(null)).toBeNull();
    expect(governorateFromPlace("zzzz")).toBeNull();
  });
});

describe("governorateFromPlace leaves shared names empty (2026-11-26)", () => {
  it("does not guess a name several governorates know", () => {
    expect(governorateFromPlace("Ennasr")).toBeNull(); // Bizerte, and Cité Ennasr in Ariana
    expect(governorateFromPlace("Soukra")).toBeNull(); // Sfax, and La Soukra in Ariana
  });
  it("reads Arabic names and délégations", () => {
    expect(governorateFromPlace("المرسى")).toBe("Tunis");
    expect(governorateFromPlace("La Soukra")).toBe("Ariana");
    expect(governorateFromPlace("Hammamet Sud")).toBe("Nabeul");
    expect(governorateFromPlace("Sidi Thabet")).toBe("Ariana");
  });
});

describe("the post's own governorate outranks the lists (2026-11-26)", async () => {
  const { textNamesGovernorate } = await import("./placeGovernorate");
  it("sees a governorate the post writes, French or Arabic, as a word", () => {
    expect(textNamesGovernorate("APPARTEMENT S+2 À BHIRA, BIZERTE, à proximité du magasin", "Bizerte")).toBe(true);
    expect(textNamesGovernorate("شقة للبيع في بنزرت", "Bizerte")).toBe(true);
    expect(textNamesGovernorate("Bureau à louer à Menzah 6", "Ariana")).toBe(false);
    expect(textNamesGovernorate("Immobilier en Tunisie", "Tunis")).toBe(false);
    expect(textNamesGovernorate("", "Tunis")).toBe(false);
  });
});
