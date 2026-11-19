import { describe, expect, it } from "vitest";
import {
  PHOTO_CHECK_SCHEMA, coverKindOf, flagsOf, normalizeFindings, suggestOrder, suggestedCover, type PhotoFinding,
} from "./photoCheck";

const finding = (o: Partial<PhotoFinding> & { index: number }): PhotoFinding => ({
  kind: "other", quality: 4, phoneVisible: false, overlayText: null, people: false, notProperty: false, ...o,
});

describe("normalizeFindings", () => {
  it("returns one finding per photo, in order, whatever order the model answered in", () => {
    const out = normalizeFindings({
      photos: [
        { index: 1, kind: "kitchen", quality: 5, phone_visible: false, overlay_text: null, people: false, not_property: false },
        { index: 0, kind: "exterior", quality: 4, phone_visible: true, overlay_text: " Agence Zitouna ", people: false, not_property: false },
      ],
    }, 3);
    expect(out[0]).toMatchObject({ index: 0, kind: "exterior", phoneVisible: true, overlayText: "Agence Zitouna" });
    expect(out[1]).toMatchObject({ index: 1, kind: "kitchen", quality: 5 });
    expect(out[2]).toBeNull();
  });

  it("drops what is off its list instead of trusting it", () => {
    const out = normalizeFindings({
      photos: [
        { index: 0, kind: "spaceship", quality: 99, phone_visible: "yes", overlay_text: "x".repeat(200), people: 1, not_property: null },
        { index: 7, kind: "living", quality: 3 },
        { index: 0, kind: "living", quality: 1 },
        { index: -1, kind: "living" },
        "junk",
      ],
    }, 2);
    expect(out[0]).toMatchObject({ kind: "other", quality: 5, phoneVisible: false, people: false, notProperty: false });
    expect(out[0]?.overlayText).toHaveLength(60);
    expect(out[1]).toBeNull();
  });

  it("survives an answer that is not an answer", () => {
    expect(normalizeFindings(null, 2)).toEqual([null, null]);
    expect(normalizeFindings({ photos: "no" }, 1)).toEqual([null]);
    expect(normalizeFindings({}, 0)).toEqual([]);
  });

  it("asks the model for exactly the fields it reads back", () => {
    const item = PHOTO_CHECK_SCHEMA.properties.photos.items;
    expect(item.required).toEqual(Object.keys(item.properties));
    expect(item.additionalProperties).toBe(false);
  });
});

describe("flagsOf", () => {
  it("names what a person would object to", () => {
    expect(flagsOf(finding({ index: 0, phoneVisible: true, overlayText: "Agence X", quality: 2 }), true))
      .toEqual(["phone", "overlay", "low_quality", "duplicate"]);
    expect(flagsOf(finding({ index: 0, people: true, notProperty: true }), false)).toEqual(["people", "not_property"]);
  });

  it("says nothing about a clean photo, and what it can about one it did not read", () => {
    expect(flagsOf(finding({ index: 0 }), false)).toEqual([]);
    expect(flagsOf(null, false)).toEqual([]);
    expect(flagsOf(null, true)).toEqual(["duplicate"]);
  });
});

describe("suggestOrder", () => {
  it("puts the outside of a house first, then the living room, then the rest by quality", () => {
    const f = [
      finding({ index: 0, kind: "bathroom", quality: 5 }),
      finding({ index: 1, kind: "living", quality: 4 }),
      finding({ index: 2, kind: "exterior", quality: 3 }),
      finding({ index: 3, kind: "kitchen", quality: 5 }),
    ];
    expect(suggestOrder(f, f.map(() => []), "residential")).toEqual([2, 1, 3, 0]);
  });

  it("puts the plot first for a land annonce", () => {
    const f = [finding({ index: 0, kind: "exterior" }), finding({ index: 1, kind: "plot" })];
    expect(suggestOrder(f, [[], []], "land")).toEqual([1, 0]);
  });

  it("sends a flagged photo behind the clean ones, even a perfect exterior", () => {
    const f = [finding({ index: 0, kind: "exterior", quality: 5, phoneVisible: true }), finding({ index: 1, kind: "bedroom", quality: 3 })];
    const flags = f.map((x) => flagsOf(x, false));
    expect(suggestOrder(f, flags, "residential")).toEqual([1, 0]);
  });

  it("keeps the owner's order between photos that rank the same", () => {
    const f = [finding({ index: 0, kind: "living" }), finding({ index: 1, kind: "living" }), finding({ index: 2, kind: "living" })];
    expect(suggestOrder(f, [[], [], []], "residential")).toEqual([0, 1, 2]);
  });

  it("does not drop a photo the model did not read", () => {
    const f: (PhotoFinding | null)[] = [null, finding({ index: 1, kind: "exterior" })];
    expect(suggestOrder(f, [[], []], "residential")).toEqual([1, 0]);
  });
});

describe("suggestedCover", () => {
  it("proposes a cover only when it is not the first photo already", () => {
    expect(suggestedCover([2, 0, 1])).toBe(2);
    expect(suggestedCover([0, 1, 2])).toBeNull();
    expect(suggestedCover([0])).toBeNull();
    expect(suggestedCover([])).toBeNull();
  });
});

describe("coverKindOf", () => {
  it("reads the category's kind", () => {
    expect(coverKindOf("land")).toBe("land");
    expect(coverKindOf("terrain")).toBe("land");
    expect(coverKindOf("commercial")).toBe("commercial");
    expect(coverKindOf("residential")).toBe("residential");
    expect(coverKindOf(null)).toBe("residential");
  });
});
