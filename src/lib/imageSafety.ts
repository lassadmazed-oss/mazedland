/**
 * What may be handed to sharp/libvips, and how much of it.
 *
 * Every picture the server decodes was sent by a person (an upload from a
 * phone, a file in the `properties` bucket). libvips decodes whatever it is
 * given — SVG through librsvg, PDF, TIFF, and a hundred more — and `sharp`'s
 * default ceiling is 268 million pixels, a gigabyte of RGBA. Both are the
 * attacker's choice unless we make them ours (security audit, 2026-11-14).
 *
 * So the decision is taken from the first bytes, before any decoder sees the
 * file, and what passes is decoded with a pixel ceiling. A phone photo is 12
 * to 50 megapixels; the ceiling leaves room for a stitched panorama.
 */

/** The formats a photo may come in. Anything else is not a photo. */
export type PhotoKind = "jpeg" | "png" | "webp" | "gif" | "heif" | "avif";

/** Pixels a single decode may reach (sharp's `limitInputPixels`). */
export const MAX_INPUT_PIXELS = 100_000_000;

/** The options every decode of a person's picture is opened with. */
export const SAFE_DECODE = { failOn: "none", limitInputPixels: MAX_INPUT_PIXELS } as const;

const ascii = (b: Uint8Array, from: number, to: number): string => {
  let s = "";
  for (let i = from; i < to && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};

/**
 * The kind of photo these bytes are, told by their magic numbers; null when
 * they are anything else (SVG and other text, PDF, TIFF, an executable...).
 *
 * HEIF and AVIF share the ISO "ftyp" box and are told apart by their brand.
 * A box that names no known image brand is refused.
 */
export function photoKind(bytes: Uint8Array): PhotoKind | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes[0] === 0x89 && ascii(bytes, 1, 4) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "webp";
  const gif = ascii(bytes, 0, 6);
  if (gif === "GIF87a" || gif === "GIF89a") return "gif";
  if (ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12);
    if (brand === "avif" || brand === "avis") return "avif";
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"].includes(brand)) return "heif";
  }
  return null;
}

/** True when the bytes are a photo format we decode. */
export function isPhoto(bytes: Uint8Array): boolean {
  return photoKind(bytes) !== null;
}
