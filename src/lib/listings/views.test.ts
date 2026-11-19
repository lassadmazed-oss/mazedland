import { describe, expect, it } from "vitest";
import { viewsShown } from "./views";
import { SETTINGS } from "@/lib/settings/registry";

describe("viewsShown", () => {
  it("waits for the threshold", () => {
    expect(viewsShown(49, 50)).toBe(false);
    expect(viewsShown(50, 50)).toBe(true);
    expect(viewsShown(442, 50)).toBe(true);
  });

  it("never shows them at 0, and from the first view at 1", () => {
    expect(viewsShown(442, 0)).toBe(false);
    expect(viewsShown(0, 1)).toBe(false);
    expect(viewsShown(1, 1)).toBe(true);
  });

  it("reads a bad number as nothing to show", () => {
    expect(viewsShown(Number.NaN, 50)).toBe(false);
    expect(viewsShown(100, Number.NaN)).toBe(false);
  });

  it("ships at 50, the owner's choice (2026-11-14)", () => {
    expect(SETTINGS.listing_views_public_min.default).toBe(50);
  });
});
