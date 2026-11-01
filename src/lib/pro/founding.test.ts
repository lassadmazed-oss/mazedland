import { describe, it, expect } from "vitest";
import { seatsOf } from "./founding";

describe("seatsOf", () => {
  it("counts what is left", () => {
    expect(seatsOf(3, 10)).toEqual({ total: 10, taken: 3, left: 7 });
    expect(seatsOf(0, 10)).toEqual({ total: 10, taken: 0, left: 10 });
  });

  it("shows no place left once every one is taken, even when the console gave more", () => {
    expect(seatsOf(10, 10)).toEqual({ total: 10, taken: 10, left: 0 });
    expect(seatsOf(13, 10)).toEqual({ total: 10, taken: 10, left: 0 });
  });

  it("never goes negative on odd settings", () => {
    expect(seatsOf(-2, 10)).toEqual({ total: 10, taken: 0, left: 10 });
    expect(seatsOf(2, 0)).toEqual({ total: 0, taken: 0, left: 0 });
  });
});
