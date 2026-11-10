/**
 * Where next/image fetches each size of a picture (next.config.ts →
 * images.loaderFile), instead of Vercel's optimizer.
 *
 * WHY. The optimizer is billed per source image, and on the free plan its
 * monthly quota ran out (2026-10-27): every picture it had not cached yet
 * answered 402 « OPTIMIZED_IMAGE_REQUEST_PAYMENT_REQUIRED ». SafeImage then
 * fell back to the full original — 200–400 kB for a card 180 px wide — and on
 * a phone the catalogue's largest picture took 5.5 s to show (Lighthouse).
 *
 * WHAT INSTEAD.
 *  - An annonce photo has its sizes made in advance when it joins an annonce
 *    (src/lib/photoSizes.ts): the narrowest one at least as wide as asked,
 *    a plain file from Supabase's CDN. Supabase's resizer bills every
 *    distinct photo it resizes in a month — $5 a thousand past the first
 *    hundred — and annonce photos are nearly all of them.
 *  - Any other picture in Supabase Storage (banners, logos, covers) goes
 *    through that resizer (/storage/v1/render/image): the width the page
 *    asks for, WebP for browsers that take it, cached on Supabase's CDN.
 *    Always `resize=contain`: given a width alone, the default (« cover »)
 *    keeps the original HEIGHT and crops — a 1536×1024 photo asked at 384
 *    came back 384×1024, a vertical strip of it.
 *  - The demo annonces' photos in /public/properties, and the sign-in
 *    picture, have sizes made in advance (scripts/static-image-variants.mjs):
 *    the smallest one at least as wide as asked.
 *  - Anything else static (logos) is small and served as it is; the width
 *    rides as a query string next/image needs, which a static file ignores.
 *
 * Runs in the browser and on the server: nothing but strings, and the one
 * import is as plain.
 */

import { hasPhotoSizes, photoSizePath, photoWidthFor } from "./photoSizes";

const OBJECT = "/storage/v1/object/public/";
const RENDER = "/storage/v1/render/image/public/";
const PHOTOS = "properties/";

/** The size made in advance of an annonce photo, or null for any other stored picture. */
function photoSize(origin: string, bucketPath: string, width: number): string | null {
  if (!bucketPath.startsWith(PHOTOS)) return null;
  const path = bucketPath.slice(PHOTOS.length);
  return hasPhotoSizes(path) ? `${origin}${OBJECT}${PHOTOS}${photoSizePath(path, photoWidthFor(width))}` : null;
}

/** The sizes made in advance for the static photos, narrowest first. */
export const STATIC_WIDTHS = [384, 640, 828] as const;

/** Static pictures that have their sizes made in advance. */
export function hasStaticSizes(src: string): boolean {
  if (/\.w\d+\.webp$/.test(src)) return false;
  return /^\/properties\/[^?#]+\.webp$/.test(src) || src === "/auth-hero.webp";
}

/** The file made for a width: the narrowest at least that wide, or the original past the widest. */
export function staticSize(src: string, width: number): string {
  const w = STATIC_WIDTHS.find((v) => v >= width);
  return w ? src.replace(/\.webp$/, `.w${w}.webp`) : src;
}

export default function imageLoader({ src, width, quality }: { src: string; width: number; quality?: number }): string {
  const q = String(quality ?? 75);
  // Supabase's resizer takes up to 2500 px.
  const w = String(Math.min(width, 2500));
  if (/^https?:\/\//.test(src)) {
    const at = src.indexOf(OBJECT);
    if (at >= 0) {
      const [path] = src.slice(at + OBJECT.length).split("?");
      return photoSize(src.slice(0, at), path, width) ?? `${src.slice(0, at)}${RENDER}${path}?width=${w}&quality=${q}&resize=contain`;
    }
    const r = src.indexOf(RENDER);
    if (r >= 0) {
      const sized = photoSize(src.slice(0, r), src.slice(r + RENDER.length).split("?")[0], width);
      if (sized) return sized;
      const u = new URL(src);
      u.searchParams.set("width", w);
      if (!u.searchParams.has("quality")) u.searchParams.set("quality", q);
      if (!u.searchParams.has("height")) u.searchParams.set("resize", "contain");
      return u.toString();
    }
    return src;
  }
  if (hasStaticSizes(src)) return staticSize(src, width);
  return `${src}${src.includes("?") ? "&" : "?"}w=${w}`;
}
