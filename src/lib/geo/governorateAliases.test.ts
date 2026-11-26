import { describe, expect, it } from "vitest";
import { GOVERNORATE_ALIASES, governorateFromName, governoratesNamedIn } from "./governorateAliases";
import { TUNISIAN_GOVERNORATES } from "@/lib/tunisia";

describe("the other names of the governorates (2026-11-26)", () => {
  it("reads a governorate written any of the usual ways", () => {
    expect(governorateFromName("Qibli")).toBe("Kebili");
    expect(governorateFromName("Kébili")).toBe("Kebili");
    expect(governorateFromName("Gbeli")).toBe("Kebili");
    expect(governorateFromName("Benzart")).toBe("Bizerte");
    expect(governorateFromName("بنزرت")).toBe("Bizerte");
    expect(governorateFromName("أريانة")).toBe("Ariana");
    expect(governorateFromName("Le Kef")).toBe("Kef");
    expect(governorateFromName("Gabes")).toBe("Gabès");
    expect(governorateFromName("MEDNINE")).toBe("Médenine");
    expect(governorateFromName("Tunisie")).toBeNull();
    expect(governorateFromName("تونس")).toBeNull(); // also Tunisia
    expect(governorateFromName("")).toBeNull();
  });

  it("finds the governorate a post writes, not the road it names", () => {
    expect(governoratesNamedIn("🔥 Opportunité à vendre à Qibli - route de Gabès derrière la clinique, quartier Bni Jadid")).toEqual(["Kebili"]);
    expect(governoratesNamedIn("أرض للبيع في قبلي طريق قابس")).toEqual(["Kebili"]);
    expect(governoratesNamedIn("Villa à Hammam Sousse, près de la plage")).toEqual(["Sousse"]);
    expect(governoratesNamedIn("APPARTEMENT À BHIRA, BIZERTE")).toEqual(["Bizerte"]);
    expect(governoratesNamedIn("Le meilleur de l'immobilier en Tunisie")).toEqual([]);
    expect(governoratesNamedIn("Maison avec une grue rue Sfax")).toEqual([]);
  });

  it("knows every governorate", () => {
    for (const g of TUNISIAN_GOVERNORATES) {
      expect(GOVERNORATE_ALIASES[g].length, g).toBeGreaterThan(0);
      expect(governorateFromName(g), g).toBe(g);
    }
  });
});
