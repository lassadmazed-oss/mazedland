import sharp from "sharp";
import { log } from "@/lib/log";
import type { getServiceSupabase } from "@/lib/supabase/admin";
import { PHOTO_WIDTHS, hasPhotoSizes, photoSizePath } from "@/lib/photoSizes";

/**
 * Writes the sizes of annonce photos next to them (src/lib/photoSizes.ts).
 *
 * Run after the annonce is saved (`after()` in the wizard's and the edit's
 * routes) and every night for whatever that missed (/api/cron/photo-sizes).
 * The widths go up narrowest first, so the widest one existing means they all
 * do. Until they are there a page still shows the photo: SafeImage falls back
 * to the original.
 */

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

const BUCKET = "properties";
const LARGEST = PHOTO_WIDTHS[PHOTO_WIDTHS.length - 1];
const sLog = log.scope("photo-sizes");

/** Every size of one photo, overwriting any half-made set. False when the original cannot be read or a write fails. */
export async function makePhotoSizes(admin: Admin, path: string): Promise<boolean> {
  const { data: blob, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !blob) {
    sLog.warn("original unreadable", { path, msg: error?.message });
    return false;
  }
  const original = Buffer.from(await blob.arrayBuffer());
  try {
    for (const width of PHOTO_WIDTHS) {
      // Upright first: a JPEG straight from a camera carries its turn in EXIF,
      // which the WebP would drop. The uploader's own WebPs are upright already.
      const out = await sharp(original, { failOn: "none" })
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 72 })
        .toBuffer();
      const { error: upErr } = await admin.storage.from(BUCKET).upload(photoSizePath(path, width), out, {
        contentType: "image/webp",
        // The path never changes for other bytes: an edit stores a new photo.
        cacheControl: "31536000",
        upsert: true,
      });
      if (upErr) {
        sLog.warn("size not stored", { path, width, msg: upErr.message });
        return false;
      }
    }
  } catch (err) {
    sLog.warn("original not decodable", { path, msg: err instanceof Error ? err.message : String(err) });
    return false;
  }
  return true;
}

/** The sizes of these photos that are missing, made one photo at a time. Never throws. */
export async function ensurePhotoSizes(admin: Admin, paths: readonly string[]): Promise<{ made: number; failed: number }> {
  let made = 0;
  let failed = 0;
  for (const path of new Set(paths.filter(hasPhotoSizes))) {
    try {
      const { data: there } = await admin.storage.from(BUCKET).exists(photoSizePath(path, LARGEST));
      if (there) continue;
      if (await makePhotoSizes(admin, path)) made++;
      else failed++;
    } catch (err) {
      failed++;
      sLog.warn("sizes not made", { path, msg: err instanceof Error ? err.message : String(err) });
    }
  }
  if (made || failed) sLog.info(`${made} photo(s) sized`, { failed });
  return { made, failed };
}
