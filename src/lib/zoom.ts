/**
 * The arithmetic of zooming into a photo of the full-screen gallery
 * (the owner, 2026-11-05: « كي تنزل على التصويرة… تكبر »). Pure, so the
 * gestures in PhotoCarousel stay thin and this stays tested.
 *
 * The photo is drawn `object-contain` in a frame and moved with
 * `translate(x, y) scale(s)` about the frame's centre: `x` and `y` are in
 * screen pixels, a point is given from the frame's centre.
 */

export type Size = { w: number; h: number };
export type Point = { x: number; y: number };
export type Zoom = { scale: number; x: number; y: number };

export const NO_ZOOM: Zoom = { scale: 1, x: 0, y: 0 };

/** What one wheel notch, one « + » and one double tap do. */
export const WHEEL_STEP = 1.2;
export const BUTTON_STEP = 1.5;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The photo's box in the frame under `object-contain`; the frame itself while its size is unknown. */
export function containedSize(frame: Size, natural: Size | null): Size {
  if (!natural || natural.w <= 0 || natural.h <= 0) return frame;
  const k = Math.min(frame.w / natural.w, frame.h / natural.h);
  return { w: natural.w * k, h: natural.h * k };
}

/**
 * The photo kept in view: on a side where the zoomed photo is larger than
 * the frame it may not leave a black band, and where it is smaller it stays
 * centred.
 */
export function clampPan(z: Zoom, frame: Size, content: Size): Zoom {
  const maxX = Math.max(0, (content.w * z.scale - frame.w) / 2);
  const maxY = Math.max(0, (content.h * z.scale - frame.h) / 2);
  return { scale: z.scale, x: clamp(z.x, -maxX, maxX), y: clamp(z.y, -maxY, maxY) };
}

/** Zoomed by `factor` about `at`, the point under the fingers or the cursor staying where it is. */
export function zoomAt(z: Zoom, factor: number, at: Point, max: number, frame: Size, content: Size): Zoom {
  const scale = clamp(z.scale * factor, 1, Math.max(1, max));
  if (scale === 1) return NO_ZOOM;
  const k = scale / z.scale;
  return clampPan({ scale, x: at.x - (at.x - z.x) * k, y: at.y - (at.y - z.y) * k }, frame, content);
}

/** A double tap: all the way in at that point, or back out when already in. */
export function toggleZoom(z: Zoom, at: Point, max: number, frame: Size, content: Size): Zoom {
  return z.scale > 1 ? NO_ZOOM : zoomAt(NO_ZOOM, max, at, max, frame, content);
}

/** Dragged by a finger or the mouse while zoomed in. */
export function panBy(z: Zoom, dx: number, dy: number, frame: Size, content: Size): Zoom {
  return z.scale > 1 ? clampPan({ scale: z.scale, x: z.x + dx, y: z.y + dy }, frame, content) : NO_ZOOM;
}

