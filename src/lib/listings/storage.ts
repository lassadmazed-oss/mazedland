import type { getServiceSupabase } from "@/lib/supabase/admin";
import { foreignPhotoPaths, type PhotoRow } from "./input";

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

/**
 * Whether a stored object is really there. A row in `listing_photos`, or a
 * receipt path sent by the client, is a promise that an upload happened; the
 * QA tour (2026-10-29) found annonces online with a photo row whose file never
 * arrived, and payments « en vérification » with a receipt nobody could open.
 *
 * A storage hiccup counts as present: the check is there to catch a missing
 * file, not to keep honest sellers offline while storage sneezes.
 */
export async function objectExists(admin: Admin, bucket: string, path: string): Promise<boolean> {
  const cut = path.lastIndexOf("/");
  const folder = cut >= 0 ? path.slice(0, cut) : "";
  const name = cut >= 0 ? path.slice(cut + 1) : path;
  if (!name) return false;
  const { data, error } = await admin.storage.from(bucket).list(folder, { limit: 100, search: name });
  if (error) return true;
  // A folder holding a file is listed under its name too, with no object id:
  // a receipt path that was only a folder passed as a file nobody could open.
  return (data ?? []).some((o) => o.name === name && Boolean((o as { id?: string | null }).id));
}

/** The paths, among those given, whose file is not in the bucket. */
export async function missingObjects(admin: Admin, bucket: string, paths: readonly string[]): Promise<string[]> {
  const present = await Promise.all(paths.map((p) => objectExists(admin, bucket, p)));
  return paths.filter((_, i) => !present[i]);
}

/**
 * The paths a seller sent that they may not attach (src/lib/listings/input.ts):
 * theirs to name are those in their own folder, and those already on this
 * annonce — an annonce from before the rule may carry another shape.
 */
export async function refusedPhotoPaths(
  admin: Admin,
  input: { photos: readonly PhotoRow[]; ownerId: string; listingId: string | null },
): Promise<string[]> {
  let attached: string[] = [];
  if (input.listingId) {
    const { data } = await admin
      .from("listings")
      .select("photos:listing_photos (storage_path)")
      .eq("id", input.listingId)
      .eq("seller_id", input.ownerId)
      .maybeSingle();
    attached = ((data?.photos ?? []) as { storage_path: string | null }[]).map((p) => p.storage_path ?? "").filter(Boolean);
  }
  return foreignPhotoPaths(input.photos, input.ownerId, attached);
}

/**
 * The paths, among those given, that no annonce uses any more: the only ones a
 * deletion may take out of the bucket. Asked after the annonce's own rows are
 * gone, so what remains is another annonce's.
 */
export async function unreferencedPhotoPaths(admin: Admin, paths: readonly string[]): Promise<string[]> {
  const wanted = [...new Set(paths.filter(Boolean))];
  const used = new Set<string>();
  for (let i = 0; i < wanted.length; i += 100) {
    const { data } = await admin.from("listing_photos").select("storage_path").in("storage_path", wanted.slice(i, i + 100));
    for (const r of (data ?? []) as { storage_path: string | null }[]) if (r.storage_path) used.add(r.storage_path);
  }
  return wanted.filter((p) => !used.has(p));
}

/** The photo paths of an annonce whose file is not in the `properties` bucket. */
export async function missingPhotos(admin: Admin, listingId: string): Promise<string[]> {
  const { data: rows } = await admin.from("listing_photos").select("storage_path").eq("listing_id", listingId);
  const paths = ((rows ?? []) as { storage_path: string | null }[]).map((r) => r.storage_path).filter((p): p is string => Boolean(p));
  return missingObjects(admin, "properties", paths);
}
