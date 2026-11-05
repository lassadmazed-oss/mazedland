import { describe, expect, it } from "vitest";
import { clampPan, containedSize, NO_ZOOM, panBy, toggleZoom, zoomAt } from "./zoom";

// A phone held upright: a 390 × 560 frame, a 1600 × 1200 photo drawn 390 × 292.5 in it.
const frame = { w: 390, h: 560 };
const content = containedSize(frame, { w: 1600, h: 1200 });

describe("the photo's box in the frame", () => {
  it("fits the photo whole, the way object-contain draws it", () => {
    expect(content).toEqual({ w: 390, h: 292.5 });
    expect(containedSize({ w: 1000, h: 500 }, { w: 1200, h: 1600 })).toEqual({ w: 375, h: 500 });
  });

  it("falls back to the frame while the photo has not loaded", () => {
    expect(containedSize(frame, null)).toEqual(frame);
    expect(containedSize(frame, { w: 0, h: 0 })).toEqual(frame);
  });
});

describe("zooming", () => {
  it("keeps the point under the fingers where it is", () => {
    // Unzoomed, the photo point under `at` is `at` itself; zoomed, it is drawn at x + scale × point.
    const at = { x: 100, y: 5 };
    const z = zoomAt(NO_ZOOM, 2, at, 3, frame, content);
    expect(z.scale).toBe(2);
    expect(z.x + at.x * z.scale).toBeCloseTo(at.x);
    expect(z.y + at.y * z.scale).toBeCloseTo(at.y);
    // Near an edge the photo stops there rather than show black under the point.
    expect(zoomAt(NO_ZOOM, 2, { x: 0, y: 200 }, 3, frame, content).y).toBe(-12.5);
  });

  it("never goes past the console's limit nor under the whole photo", () => {
    expect(zoomAt(NO_ZOOM, 10, { x: 0, y: 0 }, 3, frame, content).scale).toBe(3);
    expect(zoomAt({ scale: 2, x: 40, y: 0 }, 0.1, { x: 0, y: 0 }, 3, frame, content)).toEqual(NO_ZOOM);
  });

  it("a double tap goes all the way in, and the next one back out", () => {
    const z = toggleZoom(NO_ZOOM, { x: 0, y: 0 }, 3, frame, content);
    expect(z).toEqual({ scale: 3, x: 0, y: 0 });
    expect(toggleZoom(z, { x: 0, y: 0 }, 3, frame, content)).toEqual(NO_ZOOM);
  });
});

describe("dragging the zoomed photo", () => {
  it("stops at the photo's edges, with no black band", () => {
    const z = { scale: 2, x: 0, y: 0 };
    // 780 wide in a 390 frame: 195 either way. 585 high in a 560 frame: 12.5 either way.
    expect(panBy(z, 1000, 1000, frame, content)).toEqual({ scale: 2, x: 195, y: 12.5 });
    expect(panBy(z, -1000, -1000, frame, content)).toEqual({ scale: 2, x: -195, y: -12.5 });
  });

  it("keeps a photo smaller than the frame centred", () => {
    expect(clampPan({ scale: 1.5, x: 30, y: 30 }, frame, content)).toEqual({ scale: 1.5, x: 30, y: 0 });
  });

  it("does nothing at the whole photo, so the swipe keeps changing photos", () => {
    expect(panBy(NO_ZOOM, 50, 0, frame, content)).toEqual(NO_ZOOM);
  });
});

