/**
 * A perceptual hash of a photo — « the same picture, even resized or
 * recompressed » — so that a photo already on Mazed Immo under another annonce
 * can be told from a new one (listing_photo_hashes, 0220).
 *
 * dHash: the photo is shrunk to 9 × 8 grey pixels; each row gives 8 bits, one
 * for each pair of neighbours: 1 when the left one is brighter than the right.
 * Sixty-four bits, written as a string of 0 and 1 (what Postgres reads as
 * `bit(64)`). Two photos are the same picture when only a few bits differ.
 * Pure: reading the pixels is photoHash.server.ts.
 */
export const HASH_COLUMNS = 9;
export const HASH_ROWS = 8;
export const HASH_BITS = 64;

/** How many of the 64 bits may differ for two photos to count as the same picture. */
export const SIMILAR_MAX_BITS = 6;

export function isHash(v: unknown): v is string {
  return typeof v === "string" && /^[01]{64}$/.test(v);
}

/** The hash of 72 grey values, row by row (9 columns × 8 rows). */
export function dhashFromGrey(px: ArrayLike<number>): string {
  if (px.length !== HASH_COLUMNS * HASH_ROWS) throw new Error(`dhash wants ${HASH_COLUMNS * HASH_ROWS} pixels, got ${px.length}`);
  let bits = "";
  for (let y = 0; y < HASH_ROWS; y++) {
    for (let x = 0; x < HASH_COLUMNS - 1; x++) {
      bits += px[y * HASH_COLUMNS + x] > px[y * HASH_COLUMNS + x + 1] ? "1" : "0";
    }
  }
  return bits;
}

/** How many bits differ between two hashes. */
export function hamming(a: string, b: string): number {
  if (!isHash(a) || !isHash(b)) throw new Error("hamming wants two 64-bit hashes");
  let n = 0;
  for (let i = 0; i < HASH_BITS; i++) if (a[i] !== b[i]) n++;
  return n;
}

export function isSamePicture(a: string, b: string): boolean {
  return hamming(a, b) <= SIMILAR_MAX_BITS;
}
