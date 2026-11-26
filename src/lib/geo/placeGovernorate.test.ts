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

describe("settleGovernorate (2026-11-26)", async () => {
  const { settleGovernorate } = await import("./placeGovernorate");
  it("weighs the model, the place lists and the post's own words", () => {
    // The post writes Kebili (« Qibli »), the road to Gabès aside; the model guessed Tozeur.
    expect(settleGovernorate({ model: "Tozeur", place: "Qibli", text: "Opportunité à vendre à Qibli - route de Gabès derrière la clinique" })).toBe("Kebili");
    // The post writes Bizerte; the lists know a Bhira in Médenine only.
    expect(settleGovernorate({ model: "Bizerte", place: "Bhira", text: "APPARTEMENT À BHIRA, BIZERTE" })).toBe("Bizerte");
    // No governorate written: the lists correct the model.
    expect(settleGovernorate({ model: "Tunis", place: "Menzah 5", text: "Appartement S+2 à Menzah 5" })).toBe("Ariana");
    expect(settleGovernorate({ model: null, place: "Menzah 6", text: "Bureau à Menzah 6" })).toBe("Ariana");
    // The model and the lists agree: an agency's town in the text does not move it.
    expect(settleGovernorate({ model: "Nabeul", place: "Hammamet", text: "Agence à Tunis : villa à Hammamet" })).toBe("Nabeul");
    // Nothing to go on: the model's, or nothing.
    expect(settleGovernorate({ model: "Sfax", place: null, text: "Belle villa avec piscine" })).toBe("Sfax");
    expect(settleGovernorate({ model: null, place: null, text: "Belle villa avec piscine" })).toBeNull();
  });
});
