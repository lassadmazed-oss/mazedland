import { describe, it, expect } from "vitest";
import { swapPhoto } from "./photoSwap";

const p = (path: string) => ({ path });

describe("swapPhoto", () => {
  const gallery = [p("a"), p("b"), p("c")];

  it("puts the new photo where the old one stood, the others untouched", () => {
    expect(swapPhoto(gallery, "b", "n", p)).toEqual([p("a"), p("n"), p("c")]);
  });

  it("keeps the cover: swapping the first photo gives the new one the cover", () => {
    expect(swapPhoto(gallery, "a", "n", p)[0]).toEqual(p("n"));
    expect(swapPhoto(gallery, "a", "n", p)).toHaveLength(3);
  });

  it("adds the new photo at the end when the old one was deleted meanwhile", () => {
    expect(swapPhoto([p("a"), p("c")], "b", "n", p)).toEqual([p("a"), p("c"), p("n")]);
    expect(swapPhoto([], "b", "n", p)).toEqual([p("n")]);
  });

  it("never lists a path twice", () => {
    expect(swapPhoto([p("a"), p("n"), p("c")], "a", "n", p)).toEqual([p("n"), p("c")]);
  });

  it("does not change the array it was given", () => {
    const before = gallery.slice();
    swapPhoto(gallery, "b", "n", p);
    expect(gallery).toEqual(before);
  });
});
