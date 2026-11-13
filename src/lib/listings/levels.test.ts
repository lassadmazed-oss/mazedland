import { describe, it, expect } from "vitest";
import {
  floorOfBuildingAnswers,
  floorWords,
  levelsAnswers,
  levelsFact,
  levelsInWords,
  levelsStyle,
  levelsWords,
} from "./levels";

// The questions each category asks once 0217 is applied.
const FLAT = ["area_sqm", "rooms", "bathrooms", "floor", "levels", "year_built"];
const VILLA = ["area_sqm", "rooms", "bathrooms", "levels", "year_built", "pool"];
const OFFICE = ["area_sqm", "floor", "parking"];

describe("levelsStyle", () => {
  it("is a unit beside a floor question, a whole building without one", () => {
    expect(levelsStyle(FLAT)).toBe("unit");
    expect(levelsStyle(VILLA)).toBe("building");
    expect(levelsStyle(OFFICE)).toBeNull();
    expect(levelsStyle([])).toBeNull();
  });
});

describe("floorWords", () => {
  it("says the floor, the ground floor in words", () => {
    expect(floorWords(0, "ar")).toBe("طابق أرضي");
    expect(floorWords(3, "ar")).toBe("الطابق الثالث");
    expect(floorWords(12, "ar")).toBe("الطابق 12");
    expect(floorWords(0, "fr")).toBe("Rez-de-chaussée");
    expect(floorWords(1, "fr")).toBe("1er étage");
    expect(floorWords(3, "fr")).toBe("3e étage");
  });

  it("says the floors a duplex and a triplex take", () => {
    expect(floorWords(3, "ar", 2)).toBe("الطابق الثالث والرابع");
    expect(floorWords(0, "ar", 2)).toBe("الطابق الأرضي والأول");
    expect(floorWords(3, "ar", 3)).toBe("من الطابق الثالث للطابق الخامس");
    expect(floorWords(3, "fr", 2)).toBe("3e et 4e étages");
    expect(floorWords(0, "fr", 2)).toBe("Rez-de-chaussée et 1er étage");
    expect(floorWords(0, "fr", 3)).toBe("Du rez-de-chaussée au 2e étage");
    expect(floorWords(3, "fr", 3)).toBe("Du 3e au 5e étage");
  });
});

describe("levelsWords", () => {
  it("names a flat's levels: عادية, duplex, triplex", () => {
    expect(levelsWords(1, "unit", "ar", "appartements")).toBe("عادية");
    expect(levelsWords(1, "unit", "ar", "bureaux")).toBe("طابق واحد");
    expect(levelsWords(2, "unit", "ar")).toBe("دوبلكس");
    expect(levelsWords(3, "unit", "ar")).toBe("تريبلكس");
    expect(levelsWords(1, "unit", "fr")).toBe("Un niveau");
    expect(levelsWords(2, "unit", "fr")).toBe("Duplex");
    expect(levelsWords(3, "unit", "fr")).toBe("Triplex");
  });

  it("counts a whole house's levels, naming the duplex and the triplex", () => {
    expect(levelsWords(1, "building", "ar")).toBe("طابق واحد");
    expect(levelsWords(2, "building", "ar")).toBe("زوز طوابق · دوبلكس");
    expect(levelsWords(3, "building", "ar")).toBe("3 طوابق · تريبلكس");
    expect(levelsWords(4, "building", "ar")).toBe("4 طوابق");
    expect(levelsWords(11, "building", "ar")).toBe("11 طابق");
    expect(levelsWords(1, "building", "fr")).toBe("Plain-pied");
    expect(levelsWords(2, "building", "fr")).toBe("2 niveaux · duplex");
    expect(levelsWords(5, "building", "fr")).toBe("5 niveaux");
  });
});

describe("levelsFact — what the annonce shows", () => {
  it("shows a flat's ground floor in words, not « 0 »", () => {
    expect(levelsFact("floor", { floor: 0 }, FLAT, "ar")).toBe("طابق أرضي");
    expect(levelsFact("floor", { floor: 0 }, FLAT, "fr")).toBe("Rez-de-chaussée");
    // An office has no levels question: its floor reads the same.
    expect(levelsFact("floor", { floor: 0 }, OFFICE, "ar")).toBe("طابق أرضي");
  });

  it("shows a duplex flat on its two floors, and the duplex beside it", () => {
    const attrs = { floor: 3, levels: 2 };
    expect(levelsFact("floor", attrs, FLAT, "ar")).toBe("الطابق الثالث والرابع");
    expect(levelsFact("levels", attrs, FLAT, "ar")).toBe("دوبلكس");
    expect(levelsFact("levels", { levels: 3 }, FLAT, "fr")).toBe("Triplex");
  });

  it("says nothing of a flat on one level: that is the usual flat", () => {
    expect(levelsFact("levels", { floor: 2, levels: 1 }, FLAT, "ar")).toBeNull();
    expect(levelsFact("floor", { floor: 2, levels: 1 }, FLAT, "ar")).toBe("الطابق الثاني");
  });

  it("counts a villa's levels", () => {
    expect(levelsFact("levels", { levels: 2 }, VILLA, "ar")).toBe("زوز طوابق · دوبلكس");
    expect(levelsFact("levels", { levels: 1 }, VILLA, "fr")).toBe("Plain-pied");
  });

  it("never shows an old « RDC » on a whole villa", () => {
    // MZ-01706 before 0217: a villa on two levels that answered « Étage : RDC ».
    expect(levelsFact("floor", { floor: 0 }, VILLA, "ar")).toBeNull();
    expect(levelsFact("levels", { floor: 0 }, VILLA, "ar")).toBeNull();
  });

  it("shows one floor of a villa, and which", () => {
    expect(levelsFact("levels", { floor_only: true, levels: 1, floor: 1 }, VILLA, "ar")).toBe("طابق برك من الدار: الطابق الأول");
    expect(levelsFact("levels", { floor_only: true, levels: 1, floor: 0 }, VILLA, "ar")).toBe("طابق برك من الدار: الطابق الأرضي");
    expect(levelsFact("levels", { floor_only: true, levels: 1, floor: 1 }, VILLA, "fr")).toBe("Un étage de la maison : 1er étage");
    expect(levelsFact("levels", { floor_only: true, levels: 1, floor: 0 }, VILLA, "fr")).toBe("Un étage de la maison : rez-de-chaussée");
    expect(levelsFact("levels", { floor_only: true, levels: 1 }, VILLA, "ar")).toBe("طابق برك من الدار");
  });

  it("reads the form's strings as well as the stored numbers", () => {
    expect(levelsFact("floor", { floor: "0" }, FLAT, "ar")).toBe("طابق أرضي");
    expect(levelsFact("levels", { floor_only: "true", floor: "2" }, VILLA, "ar")).toBe("طابق برك من الدار: الطابق الثاني");
  });

  it("leaves every other question to the caller", () => {
    expect(levelsFact("rooms", { rooms: 3 }, FLAT, "ar")).toBeUndefined();
    expect(levelsFact("pool", { pool: true }, VILLA, "fr")).toBeUndefined();
  });

  it("shows nothing for no answer, or one that is not a whole number", () => {
    expect(levelsFact("floor", {}, FLAT, "ar")).toBeNull();
    expect(levelsFact("floor", { floor: "" }, FLAT, "ar")).toBeNull();
    expect(levelsFact("floor", { floor: 2.5 }, FLAT, "ar")).toBeNull();
    expect(levelsFact("levels", { levels: 0 }, VILLA, "ar")).toBeNull();
  });
});

describe("levelsAnswers", () => {
  it("types the three answers", () => {
    expect(levelsAnswers({ floor: "3", levels: 2 })).toEqual({ floor: 3, levels: 2, floorOnly: false });
    expect(levelsAnswers({ floor_only: true, floor: 0, levels: 1 })).toEqual({ floor: 0, levels: 1, floorOnly: true });
    expect(levelsAnswers({ floor: -1, levels: "x" })).toEqual({ floor: null, levels: null, floorOnly: false });
  });
});

describe("floorOfBuildingAnswers — what the form sends for one floor of a house", () => {
  it("sends the flag, one level and the floor chosen", () => {
    expect(floorOfBuildingAnswers(VILLA, { floor_only: "true", levels: "1", floor: "1" })).toEqual({ floor_only: true, levels: 1, floor: 1 });
    expect(floorOfBuildingAnswers(VILLA, { floor_only: "true", floor: "" })).toEqual({ floor_only: true, levels: 1 });
  });

  it("sends nothing more for a whole house, a flat, or no levels question", () => {
    expect(floorOfBuildingAnswers(VILLA, { levels: "2", floor: "0" })).toBeNull();
    expect(floorOfBuildingAnswers(FLAT, { floor_only: "true", floor: "3" })).toBeNull();
    expect(floorOfBuildingAnswers(OFFICE, { floor_only: "true", floor: "3" })).toBeNull();
  });
});

describe("levelsInWords", () => {
  it("reads duplex and triplex in both scripts, and R+1", () => {
    expect(levelsInWords("Villa duplex")).toBe(2);
    expect(levelsInWords("APPARTEMENT TRIPLEX")).toBe(3);
    expect(levelsInWords("فيلا دوبليكس")).toBe(2);
    expect(levelsInWords("شقة دوبلكس")).toBe(2);
    expect(levelsInWords("تريبلكس")).toBe(3);
    expect(levelsInWords("Villa R+1")).toBe(2);
    expect(levelsInWords("Maison plain-pied")).toBe(1);
  });

  it("reads nothing in a type that says neither", () => {
    expect(levelsInWords("Villa")).toBeNull();
    expect(levelsInWords("Appartement S+2")).toBeNull();
    expect(levelsInWords("")).toBeNull();
  });
});
