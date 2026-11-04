/**
 * The home page's map of Tunisia (HomeMap) — where each governorate's count
 * stands. Pure, so the layout is tested without a page.
 *
 * A count stands on its governorate's chief town (GOVERNORATE_ANCHOR), as a
 * circle growing with the number. Grand Tunis is four governorates within a
 * few kilometres, so the circles are pushed apart until none overlaps, and
 * one moved off its town keeps a line to it.
 */

export type Bubble = { gov: string; count: number; x: number; y: number; r: number; ax: number; ay: number };

/** The circle's radius, in the map's units: from 11 for one annonce to 22 for the most. */
export const bubbleRadius = (count: number, max: number) => 11 + 11 * Math.sqrt(count / Math.max(1, max));

/**
 * The circles, placed: on their towns, then moved apart (a few dozen rounds
 * of pairwise pushes) and kept inside the frame. Biggest first, so the small
 * ones move around the big ones.
 */
export function layoutBubbles(
  items: readonly { gov: string; count: number; anchor: readonly [number, number] }[],
  frame: readonly [number, number],
  gap = 2,
): Bubble[] {
  const max = Math.max(1, ...items.map((i) => i.count));
  const b: Bubble[] = items
    .filter((i) => i.count > 0)
    .map((i) => ({ gov: i.gov, count: i.count, x: i.anchor[0], y: i.anchor[1], r: bubbleRadius(i.count, max), ax: i.anchor[0], ay: i.anchor[1] }))
    .sort((p, q) => q.count - p.count || p.gov.localeCompare(q.gov));
  for (let round = 0; round < 80; round++) {
    let moved = false;
    for (let i = 0; i < b.length; i++) {
      for (let j = i + 1; j < b.length; j++) {
        const p = b[i];
        const q = b[j];
        let dx = q.x - p.x;
        let dy = q.y - p.y;
        let d = Math.hypot(dx, dy);
        const need = p.r + q.r + gap;
        if (d >= need) continue;
        // Two on the same spot: apart along a fixed direction, so the layout is the same every time.
        if (d < 0.01) {
          dx = 1;
          dy = 0.6;
          d = Math.hypot(dx, dy);
        }
        const push = (need - d) / 2;
        // The bigger one moves less: the town with the most annonces keeps its place.
        const share = q.r / (p.r + q.r);
        p.x -= (dx / d) * push * 2 * (1 - share);
        p.y -= (dy / d) * push * 2 * (1 - share);
        q.x += (dx / d) * push * 2 * share;
        q.y += (dy / d) * push * 2 * share;
        moved = true;
      }
    }
    for (const c of b) {
      c.x = Math.min(frame[0] - c.r, Math.max(c.r, c.x));
      c.y = Math.min(frame[1] - c.r, Math.max(c.r, c.y));
    }
    if (!moved) break;
  }
  return b.map((c) => ({ ...c, x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10 }));
}
