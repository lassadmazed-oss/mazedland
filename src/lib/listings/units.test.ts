import { describe, it, expect } from "vitest";
import {
  addUnit,
  homesSummary,
  MAX_UNIT_LINES,
  normalizeUnits,
  parseUnits,
  serializeUnits,
  UNITS_MAX_LENGTH,
  unitLineWords,
  unitsSummary,
  unitTotals,
  unitTypeWords,
  type BuildingUnit,
} from "./units";

const u = (type: BuildingUnit["type"], count: number, area: number | null = null, status: BuildingUnit["status"] = null): BuildingUnit => ({ type, count, area, status });

describe("parseUnits", () => {
  it("reads « kind:count:area:status », each part after the count optional", () => {
    expect(parseUnits("s2:4:95:rented;s3:2;shop:1:40")).toEqual([u("s2", 4, 95, "rented"), u("s3", 2), u("shop", 1, 40)]);
    expect(parseUnits("s2:3::free")).toEqual([u("s2", 3, null, "free")]);
  });

  it("drops a line that says nothing sure, and keeps the rest", () => {
    // Unknown kind, no count, 0, 100, not a number, an empty piece.
    expect(parseUnits("villa:2;s2;s2:0;s2:100;s2:x;;s1:2")).toEqual([u("s1", 2)]);
  });

  it("drops a figure out of its range but keeps the line", () => {
    expect(parseUnits("s2:2:0")).toEqual([u("s2", 2)]);
    expect(parseUnits("s2:2:99999")).toEqual([u("s2", 2)]);
    expect(parseUnits("s2:2:80:sold")).toEqual([u("s2", 2, 80)]);
  });

  it("reads nothing from what is not a string", () => {
    for (const v of [null, undefined, 42, true, {}, ["s2:1"]]) expect(parseUnits(v)).toEqual([]);
    expect(parseUnits("")).toEqual([]);
  });

  it("stops at the eighth line and at 200 characters", () => {
    const many = Array.from({ length: 12 }, (_, i) => `s${(i % 4) + 1}:${i + 1}`).join(";");
    expect(parseUnits(many)).toHaveLength(MAX_UNIT_LINES);
    const long = `s2:1;${"x".repeat(UNITS_MAX_LENGTH)};s3:1`;
    expect(parseUnits(long)).toEqual([u("s2", 1)]);
  });
});

describe("serializeUnits and normalizeUnits", () => {
  it("writes the canonical form and reads it back", () => {
    const lines = [u("s2", 4, 95, "rented"), u("s3", 2), u("shop", 1, 40), u("s1", 1, null, "free")];
    const text = serializeUnits(lines);
    expect(text).toBe("s2:4:95:rented;s3:2;shop:1:40;s1:1::free");
    expect(parseUnits(text)).toEqual(lines);
  });

  it("keeps the worst case inside what an answer may hold", () => {
    const worst = Array.from({ length: MAX_UNIT_LINES }, () => u("studio", 99, 5000, "rented"));
    expect(serializeUnits(worst).length).toBeLessThanOrEqual(UNITS_MAX_LENGTH);
  });

  it("normalizes what the server receives: garbage out, the lines it can read in order, null for none", () => {
    expect(normalizeUnits(" s2:4 ; nope ; s3:2:90 ")).toBe("s2:4;s3:2:90");
    expect(normalizeUnits("4 appartements S+2")).toBeNull();
    expect(normalizeUnits("")).toBeNull();
    expect(normalizeUnits(12)).toBeNull();
  });
});

describe("addUnit", () => {
  it("grows the plain line of a kind instead of repeating it", () => {
    let lines: BuildingUnit[] = [];
    for (let i = 0; i < 4; i++) lines = addUnit(lines, "s2");
    expect(lines).toEqual([u("s2", 4)]);
  });

  it("adds a line when the kind has details of its own, and stops at the last line", () => {
    expect(addUnit([u("s2", 4, 95, "rented")], "s2")).toEqual([u("s2", 4, 95, "rented"), u("s2", 1)]);
    const full = Array.from({ length: MAX_UNIT_LINES }, (_, i) => u("s1", i + 1, 50));
    expect(addUnit(full, "s3")).toEqual(full);
  });

  it("never goes past 99 of a kind", () => {
    expect(addUnit([u("studio", 99)], "studio")).toEqual([u("studio", 99)]);
  });
});

describe("unitTotals and the words", () => {
  const building = [u("s2", 4, 95, "rented"), u("s3", 2), u("studio", 1), u("shop", 1, 40), u("office", 2), u("garage", 3)];

  it("counts flats and studios apart from shops, offices and garages", () => {
    expect(unitTotals(building)).toEqual({ homes: 7, shops: 1, offices: 2, garages: 3, all: 13 });
    expect(unitTotals([])).toEqual({ homes: 0, shops: 0, offices: 0, garages: 0, all: 0 });
  });

  it("says the totals in Tunisian Arabic, one, two, three to ten, eleven and more", () => {
    expect(unitsSummary(building, "ar")).toBe("7 شقق · محل · زوز مكاتب · 3 كراجات");
    expect(unitsSummary([u("s2", 1)], "ar")).toBe("شقة");
    expect(unitsSummary([u("s2", 2)], "ar")).toBe("زوز شقق");
    expect(unitsSummary([u("s2", 12)], "ar")).toBe("12 شقة");
  });

  it("says them in French, plural from two", () => {
    expect(unitsSummary(building, "fr")).toBe("7 appartements · 1 local commercial · 2 bureaux · 3 garages");
    expect(unitsSummary([u("s2", 1)], "fr")).toBe("1 appartement");
    expect(unitsSummary([], "fr")).toBe("");
  });

  it("says the flats alone for the card", () => {
    expect(homesSummary(building, "ar")).toBe("7 شقق");
    expect(homesSummary(building, "fr")).toBe("7 appartements");
    expect(homesSummary([u("shop", 2)], "ar")).toBe("");
  });

  it("writes S+n in Latin, isolated, in both languages", () => {
    expect(unitTypeWords("s2", "ar")).toBe("⁦S+2⁩");
    expect(unitTypeWords("s2", "fr")).toBe("⁦S+2⁩");
    expect(unitTypeWords("s4", "ar")).toBe("⁦S+4⁩ وأكثر");
    expect(unitTypeWords("studio", "ar")).toBe("ستوديو");
    expect(unitTypeWords("shop", "fr")).toBe("Local commercial");
  });

  it("writes one line in a sentence", () => {
    expect(unitLineWords(u("s2", 4, 95, "rented"), "ar")).toBe("4 × ⁦S+2⁩ · 95 م² · مكرية");
    expect(unitLineWords(u("shop", 1), "fr")).toBe("1 × Local commercial");
    expect(unitLineWords(u("s1", 2, null, "free"), "fr")).toBe("2 × ⁦S+1⁩ · Libre");
  });
});
