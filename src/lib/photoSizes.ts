/**
 * The sizes made in advance of every annonce photo.
 *
 * Every picture used to go through Supabase's resizer (`/render/image/`),
 * which bills each distinct photo it resizes in a month: 100 free, then $5 a
 * thousand. At 10 000 annonces of six photos that is up to $300 a month for
 * resizing alone. So when a photo joins an annonce the server writes it once
 * at each of these widths, next to the original
 * (`<user>/annonce-….webp` → `<user>/annonce-….w640.webp`), and the pages ask
 * for those files as they are: plain objects from the storage CDN, nothing
 * resized on the way (src/lib/photoSizes.server.ts makes them,
 * src/lib/imageLoader.ts picks one for next/image, `annoncePhotoUrl` for a
 * plain `<img>`).
 *
 * Only annonce photos have sizes. The agences' logos and covers and the
 * projects' covers come through the same uploader, so their paths look the
 * same, but they are drawn with `propertyPhotoUrl(…, { transform })` and keep
 * the resizer: a few hundred pictures, not tens of thousands. Drawn with
 * next/image one day, such a picture would find no size and SafeImage would
 * show the original.
 *
 * Shared by the browser (the loader) and the server: nothing here touches
 * the network.
 */

/** Narrowest first; the last is the largest a page ever asks for (the original is 1600 px at most). */
export const PHOTO_WIDTHS = [384, 640, 1080, 1600] as const;

/** A photo the uploader stored (src/app/api/annonces/photo-url): `<user id>/annonce-<stamp>-<rand>-<i>.<ext>`. */
const ANNONCE_PHOTO = /^[0-9a-f-]{36}\/annonce-\d+-\d+-\d+\.[a-z0-9]{1,5}$/i;

/** True for a bucket path whose sizes are made in advance: an annonce photo, never one of its sizes. */
export function hasPhotoSizes(path: string): boolean {
  return ANNONCE_PHOTO.test(path);
}

/** The bucket path of one size of the photo. */
export function photoSizePath(path: string, width: number): string {
  return `${path.replace(/\.[a-z0-9]{1,5}$/i, "")}.w${width}.webp`;
}

/** Every size of the photo, narrowest first; none for a path that has no sizes. */
export function photoSizePaths(path: string): string[] {
  return hasPhotoSizes(path) ? PHOTO_WIDTHS.map((w) => photoSizePath(path, w)) : [];
}

/** The size to serve for a width asked: the narrowest at least as wide, the largest past it. */
export function photoWidthFor(width: number): number {
  return PHOTO_WIDTHS.find((w) => w >= width) ?? PHOTO_WIDTHS[PHOTO_WIDTHS.length - 1];
}

/** The photos' paths with all their sizes, for a delete that must leave nothing behind. */
export function withPhotoSizes(paths: readonly string[]): string[] {
  return [...new Set(paths.flatMap((p) => [p, ...photoSizePaths(p)]))];
}
