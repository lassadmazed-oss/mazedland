import { describe, expect, it } from "vitest";
import { HASH_BITS, dhashFromGrey, hamming, isHash, isSamePicture } from "./photoHash";

/** A 9 × 8 grey picture from a function of the column and the row. */
const picture = (f: (x: number, y: number) => number): number[] => {
  const px: number[] = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 9; x++) px.push(f(x, y));
  return px;
};

describe("dhashFromGrey", () => {
  it("writes 64 bits, one per pair of neighbours", () => {
    const h = dhashFromGrey(picture((x) => x * 10));
    expect(h).toHaveLength(HASH_BITS);
    expect(isHash(h)).toBe(true);
  });

  it("reads « brighter than the neighbour on its right » as a 1", () => {
    expect(dhashFromGrey(picture((x) => 255 - x * 10))).toBe("1".repeat(64)); // darker to the right
    expect(dhashFromGrey(picture((x) => x * 10))).toBe("0".repeat(64)); // brighter to the right
  });

  it("does not change when the whole picture is brighter or darker", () => {
    const base = picture((x, y) => (x * 17 + y * 31) % 200);
    expect(dhashFromGrey(base.map((v) => v + 40))).toBe(dhashFromGrey(base));
    expect(dhashFromGrey(base.map((v) => v * 0.8))).toBe(dhashFromGrey(base));
  });

  it("refuses anything but 72 pixels", () => {
    expect(() => dhashFromGrey([1, 2, 3])).toThrow();
  });
});

describe("hamming", () => {
  it("counts the bits that differ", () => {
    const a = "0".repeat(64);
    expect(hamming(a, a)).toBe(0);
    expect(hamming(a, "1" + "0".repeat(63))).toBe(1);
    expect(hamming(a, "1".repeat(64))).toBe(64);
  });

  it("refuses what is not a hash", () => {
    expect(() => hamming("abc", "0".repeat(64))).toThrow();
  });
});

describe("isSamePicture", () => {
  const base = picture((x, y) => (x * 23 + y * 41) % 220);

  it("counts a resized or recompressed photo (a few bits off) as the same", () => {
    const noisy = base.map((v, i) => (i % 17 === 0 ? v + 3 : v));
    expect(isSamePicture(dhashFromGrey(base), dhashFromGrey(noisy))).toBe(true);
  });

  it("does not take two different photos for one", () => {
    const other = picture((x, y) => ((x * 7 + y * 53) * 13) % 230);
    expect(isSamePicture(dhashFromGrey(base), dhashFromGrey(other))).toBe(false);
  });
});

describe("isHash", () => {
  it("is 64 characters of 0 and 1", () => {
    expect(isHash("0".repeat(64))).toBe(true);
    expect(isHash("0".repeat(63))).toBe(false);
    expect(isHash("2".repeat(64))).toBe(false);
    expect(isHash(7)).toBe(false);
  });
});
