/**
 * Changing one photo of an annonce for another, in the same place.
 *
 * Until now a seller who found a photo bad had to delete it, add a new one —
 * which went to the END of the gallery — and move it back with the arrows; a
 * bad cover meant the star as well. « Changer » takes the new photo's place:
 * same position, so the same cover if it was the first.
 *
 * Pure, so the tests can pin the order.
 */
export type PhotoRef = { path: string };

/**
 * The gallery with `oldPath` replaced by `newPath` where it stands. When the old photo is
 * no longer there (deleted while the new one was going up) the new photo is
 * added at the end instead, so the seller never loses the photo they just sent.
 * A path already in the gallery is not added twice.
 */
export function swapPhoto<T extends PhotoRef>(prev: readonly T[], oldPath: string, newPath: string, make: (path: string) => T): T[] {
  if (prev.some((p) => p.path === newPath)) return prev.filter((p) => p.path !== oldPath || p.path === newPath);
  if (!prev.some((p) => p.path === oldPath)) return [...prev, make(newPath)];
  return prev.map((p) => (p.path === oldPath ? make(newPath) : p));
}
