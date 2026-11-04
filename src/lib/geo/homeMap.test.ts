import { describe, it, expect } from "vitest";
import { bubbleRadius, layoutBubbles } from "./homeMap";
import { GOVERNORATE_ANCHOR, GOVERNORATE_PATHS, TUNISIA_VIEWBOX } from "./tunisiaShape";
import { TUNISIAN_GOVERNORATES } from "@/lib/tunisia";

describe("tunisiaShape", () => {
  it("draws every governorate, with its town inside the frame", () => {
    for (const g of TUNISIAN_GOVERNORATES) {
      expect(GOVERNORATE_PATHS[g], g).toMatch(/^M[\d. L]+Z/);
      const [x, y] = GOVERNORATE_ANCHOR[g];
      expect(x > 0 && x < TUNISIA_VIEWBOX[0] && y > 0 && y < TUNISIA_VIEWBOX[1], g).toBe(true);
    }
  });
});

describe("layoutBubbles", () => {
  const counts: Record<string, number> = { Sfax: 21, Ariana: 6, Tunis: 5, Nabeul: 4, "Ben Arous": 4, Sousse: 4, Manouba: 1, Mahdia: 1, Gabès: 1, Médenine: 1, Kef: 0 };
  const items = Object.entries(counts).map(([gov, count]) => ({ gov, count, anchor: GOVERNORATE_ANCHOR[gov] }));
  const out = layoutBubbles(items, TUNISIA_VIEWBOX);

  it("leaves out the governorates without an annonce", () => {
    expect(out.map((b) => b.gov)).not.toContain("Kef");
    expect(out).toHaveLength(10);
  });
  it("lets no circle cover another, Grand Tunis included", () => {
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const [p, q] = [out[i], out[j]];
        expect(Math.hypot(p.x - q.x, p.y - q.y), `${p.gov}/${q.gov}`).toBeGreaterThanOrEqual(p.r + q.r - 0.5);
      }
    }
  });
  it("keeps the biggest on its town, and every circle in the frame", () => {
    const sfax = out.find((b) => b.gov === "Sfax")!;
    expect(Math.hypot(sfax.x - sfax.ax, sfax.y - sfax.ay)).toBeLessThan(2);
    for (const b of out) expect(b.x - b.r >= 0 && b.y - b.r >= 0 && b.x + b.r <= TUNISIA_VIEWBOX[0] && b.y + b.r <= TUNISIA_VIEWBOX[1]).toBe(true);
  });
  it("grows with the count", () => {
    expect(bubbleRadius(21, 21)).toBe(22);
    expect(bubbleRadius(1, 21)).toBeLessThan(bubbleRadius(5, 21));
  });
  it("is the same every time", () => {
    expect(layoutBubbles(items, TUNISIA_VIEWBOX)).toEqual(out);
  });
});
