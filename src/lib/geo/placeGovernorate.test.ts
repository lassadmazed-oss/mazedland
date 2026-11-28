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

describe("towns the post writes (2026-11-28)", async () => {
  const { settleGovernorate } = await import("./placeGovernorate");
  const { townGovernoratesIn, TOWN_NAMES } = await import("./townNames");
  const { nameKey } = await import("./governorateAliases");
  it("a well-known town settles a post that writes no governorate", () => {
    // Went online under Nabeul: the model read « zone touristique » as Hammamet's.
    const djerba = "Location Annuelle – Villa S+4 avec piscine privée à Djerba Réf. : Walid – Zone touristique, Djerba Loyer : 2 500 DT / mois";
    expect(settleGovernorate({ model: "Nabeul", place: null, text: djerba })).toBe("Médenine");
    expect(settleGovernorate({ model: null, place: null, text: "دار للبيع في جربة ميدون" })).toBe("Médenine");
    expect(settleGovernorate({ model: null, place: null, text: "Studio meublé à Sahloul" })).toBe("Sousse");
  });
  it("leaves the model alone when the towns disagree, or a governorate is written, or it is only a road", () => {
    // Two governorates' towns: nothing to choose between them.
    expect(settleGovernorate({ model: "Tunis", place: null, text: "Agence de La Marsa : villa à Hammamet" })).toBe("Tunis");
    // The post writes its governorate: that outranks any town.
    expect(settleGovernorate({ model: "Sousse", place: null, text: "Appartement à Sousse, 10 min de Monastir et Skanes" })).toBe("Sousse");
    // « Route de Hammamet » is a road, not where the property is.
    expect(townGovernoratesIn("Terrain route de Hammamet km 5")).toEqual([]);
    expect(settleGovernorate({ model: "Ben Arous", place: null, text: "Terrain route de Hammamet km 5" })).toBe("Ben Arous");
  });
  it("every town name points to one governorate", () => {
    const seen = new Map<string, string>();
    for (const [g, towns] of Object.entries(TOWN_NAMES)) {
      for (const t of towns ?? []) {
        const k = nameKey(t);
        expect(seen.get(k) ?? g, `${t} is in ${seen.get(k)} and ${g}`).toBe(g);
        seen.set(k, g);
      }
    }
  });
});

describe("names that are not the governorate (2026-11-28)", async () => {
  const { settleGovernorate } = await import("./placeGovernorate");
  const { governoratesNamedIn } = await import("./governorateAliases");
  it("« Aïn » before a name makes it another place", () => {
    // Twelve annonces of Aïn Zaghouan (Tunis) went online under Zaghouan.
    expect(governoratesNamedIn("À LOUER – APPARTEMENT S+1 À AÏN ZAGHOUAN NORD")).toEqual([]);
    expect(governoratesNamedIn("شقة للكراء في عين زغوان")).toEqual([]);
    expect(settleGovernorate({ model: "Tunis", place: null, text: "Appartement S+3 · Aïn Zaghouan Nord, jamais habité" })).toBe("Tunis");
    // Aïn Mestir is in Rafraf (Bizerte), not Monastir (« Mestir »).
    expect(settleGovernorate({ model: "Bizerte", place: null, text: "Terrain 500 m² à Aïn Mestir – Rafraf plage" })).toBe("Bizerte");
    // Zaghouan itself still counts.
    expect(governoratesNamedIn("Maison à vendre à Zaghouan centre")).toEqual(["Zaghouan"]);
  });
  it("reads the place at the post's start, not a name mentioned further down", () => {
    const far = "Appartement S+2 neuf à El Mourouj 4, devant le marché de gros. " + "Très lumineux, cuisine équipée, parking. ".repeat(5) + "À 20 minutes du centre de Tunis.";
    expect(settleGovernorate({ model: "Ben Arous", place: null, text: far })).toBe("Ben Arous");
    const footer = "Appartement S+1 à louer à la Nouvelle Soukra, 4ème étage, résidence calme. " + "Climatisation, chauffage central, ascenseur. ".repeat(4) + "Agence Immoliv, Les Berges du Lac 2.";
    expect(settleGovernorate({ model: "Ariana", place: null, text: footer })).toBe("Ariana");
  });
});

describe("the first place written, and names that are only an agency's or a road's (2026-11-28)", async () => {
  const { settleGovernorate } = await import("./placeGovernorate");
  it("an agency's name further on does not move the place", () => {
    expect(settleGovernorate({ model: "Nabeul", place: null, text: "À VENDRE – TERRAIN DE 600 M² À HAMMAMET SUD L’agence immobilière Tunis First vous propose à la vente un terrain" })).toBe("Nabeul");
    expect(settleGovernorate({ model: null, place: null, text: "À VENDRE – TERRAIN DE 600 M² À HAMMAMET SUD L’agence immobilière Tunis First vous propose à la vente un terrain" })).toBe("Nabeul");
    expect(settleGovernorate({ model: "Ariana", place: null, text: "À VENDRE | APPARTEMENT S+1 NEUF À LA NOUVELLE SOUKRA – 298 000 DT. L’agence immobilière Tunis First" })).toBe("Ariana");
  });
  it("roads, glued words, and places that only sound like a governorate", () => {
    // « gp8بنزرت »: Bizerte, glued to the road's number; Tunis is only « 30 minutes away ».
    expect(settleGovernorate({ model: "Bizerte", place: null, text: "للبيع هكتار على الطريق الرئيسي gp8بنزرت تبعد على تونس العاصمة 30 دقيقة" })).toBe("Bizerte");
    // A road to Mahdia, in Sfax.
    expect(settleGovernorate({ model: "Sfax", place: null, text: "À vendre une maison de deux étages Route d'Al Mahdia, km 3" })).toBe("Sfax");
    // « Carthage Land » is in Hammamet.
    expect(settleGovernorate({ model: "Nabeul", place: null, text: "Bel étage de villa s3 📍Yasmine, à proximité de Carthage Land" })).toBe("Nabeul");
    // A town alone does not outrank the place lists.
    expect(settleGovernorate({ model: "Tunis", place: "Menzah 5", text: "Appartement à Menzah 5, à 10 minutes de La Marsa" })).toBe("Ariana");
  });
});

describe("an agency's name is not a place (2026-11-28)", async () => {
  const { governoratesNamedIn } = await import("./governorateAliases");
  it("« Tunis First », « Sousse Immobilier »", () => {
    expect(governoratesNamedIn("Bureau H+4 à L'Aouina. L’agence immobilière Tunis First vous propose")).toEqual([]);
    expect(governoratesNamedIn("Sousse Immobilier vous propose une villa à Monastir")).toEqual(["Monastir"]);
    expect(governoratesNamedIn("Villa à Tunis, première ligne")).toEqual(["Tunis"]);
  });
});
