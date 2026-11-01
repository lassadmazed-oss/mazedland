/**
 * The sizes BrandLogo hands next/image are the files' own. The files are
 * remade by scripts/brand-logo.mjs; a size left behind would squash the logo
 * for the instant before it loads, and shift the bar around it.
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import sharp from "sharp";
import { BRAND_FILES } from "./BrandLogo";

describe("BrandLogo", () => {
  for (const [variant, f] of Object.entries(BRAND_FILES)) {
    it(`${variant}: ${f.src} is ${f.width} × ${f.height}`, async () => {
      const m = await sharp(path.join(process.cwd(), "public", f.src)).metadata();
      expect([m.width, m.height]).toEqual([f.width, f.height]);
      expect(m.hasAlpha).toBe(true);
    });
  }
});
