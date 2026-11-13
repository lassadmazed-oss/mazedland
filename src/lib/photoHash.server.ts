import sharp from "sharp";
import type { getServiceSupabase } from "@/lib/supabase/admin";
import { log } from "@/lib/log";
import { HASH_COLUMNS, HASH_ROWS, SIMILAR_MAX_BITS, dhashFromGrey, isHash } from "./photoHash";
import { photoSizePath } from "./photoSizes";

/**
 * Reading photos from the `properties` bucket to hash them and to look at them
 * (src/lib/photoHash.ts, listing_photo_hashes 0220). The hash is made from the
 * smallest size there is: a photo's look does not need its pixels.
 */
type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

const BUCKET = "properties";
const hLog = log.scope("photo-hash");

/** The hash of an image's bytes: upright, grey, 9 × 8. Throws when the bytes are not an image. */
export async function dhashOfImage(bytes: Buffer): Promise<string> {
  const grey = await sharp(bytes, { failOn: "none" })
    .rotate()
    .greyscale()
    .resize(HASH_COLUMNS, HASH_ROWS, { fit: "fill" })
    .raw()
    .toBuffer();
  return dhashFromGrey(grey);
}

/** A photo's bytes at about this width (its pre-made size when there is one), else the original; null when unreadable. */
export async function readPhoto(admin: Admin, path: string, width: number): Promise<{ bytes: Buffer; path: string } | null> {
  for (const candidate of [photoSizePath(path, width), path]) {
    const { data, error } = await admin.storage.from(BUCKET).download(candidate);
    if (!error && data) return { bytes: Buffer.from(await data.arrayBuffer()), path: candidate };
  }
  hLog.warn("photo unreadable", { path });
  return null;
}

export async function storeHash(admin: Admin, listingId: string, path: string, hash: string): Promise<void> {
  if (!isHash(hash)) return;
  const { error } = await admin
    .from("listing_photo_hashes")
    .upsert({ storage_path: path, listing_id: listingId, dhash: hash }, { onConflict: "storage_path" });
  if (error) hLog.warn("hash not stored", { path, msg: error.message });
}

export type SimilarPhoto = { listing_id: string; storage_path: string; distance: number };

/** The photos on other annonces that are the same picture as this hash. */
export async function similarPhotos(admin: Admin, hash: string, excludeListing: string | null): Promise<SimilarPhoto[]> {
  if (!isHash(hash)) return [];
  const { data, error } = await admin.rpc("similar_photos", { p_hash: hash, p_max: SIMILAR_MAX_BITS, p_exclude: excludeListing });
  if (error) {
    hLog.warn("similar_photos failed", { msg: error.message });
    return [];
  }
  return (data ?? []) as SimilarPhoto[];
}
