import { describe, expect, it } from "vitest";
import { pageNumber, pageNumbers } from "./paging";

describe("pageNumber", () => {
  it("reads a whole page number", () => {
    expect(pageNumber("2")).toBe(2);
    expect(pageNumber("9999")).toBe(9999);
    expect(pageNumber("2.7")).toBe(2);
  });

  it("is the first page for anything that is not one", () => {
    expect(pageNumber(undefined)).toBe(1);
    expect(pageNumber("")).toBe(1);
    expect(pageNumber("abc")).toBe(1);
    expect(pageNumber("0")).toBe(1);
    expect(pageNumber("-3")).toBe(1);
    expect(pageNumber("1")).toBe(1);
  });
});

describe("pageNumbers (the pager, 2026-11-25)", () => {
  it("shows the first, the last and two around the current page, with gaps", () => {
    expect(pageNumbers(1, 70)).toEqual([1, 2, 3, null, 70]);
    expect(pageNumbers(10, 70)).toEqual([1, null, 8, 9, 10, 11, 12, null, 70]);
    expect(pageNumbers(70, 70)).toEqual([1, null, 68, 69, 70]);
  });

  it("fills a one-page gap with the page instead of « … »", () => {
    expect(pageNumbers(5, 70)).toEqual([1, 2, 3, 4, 5, 6, 7, null, 70]);
    expect(pageNumbers(2, 3)).toEqual([1, 2, 3]);
  });
});
