import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron/auth";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { fail } from "@/lib/http/errors";
import { log } from "@/lib/log";
import { hasPhotoSizes } from "@/lib/photoSizes";
import { dhashOfImage, readPhoto, storeHash } from "@/lib/photoHash.server";
import { everyRow } from "@/lib/storage/walk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A photo takes a fraction of a second; a run is capped by `limit`.
export const maxDuration = 300;

const cLog = log.scope("cron-photo-hashes");

/**
 * GET /api/cron/photo-hashes — the perceptual hash of the annonce photos that
 * have none yet (src/lib/photoHash.ts, 0220), so that « this photo is already on
 * another annonce » can be told. Nightly from pg_cron with the shared secret;
 * `?limit=` (default 100, at most 500) bounds one run. Only photos shaped like
 * annonce photos: an agence's logo or cover is not looked up.
 */
export async function GET(req: NextRequest) {
  const denied = verifyCronSecret(req);
  if (denied) return denied;
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const limit = Math.min(500, Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 100));
  try {
    const photos = await everyRow<{ listing_id: string; storage_path: string | null }>((a, b) =>
      admin.from("listing_photos").select("listing_id, storage_path").order("id").range(a, b),
    );
    const hashed = new Set(
      (await everyRow<{ storage_path: string }>((a, b) => admin.from("listing_photo_hashes").select("storage_path").order("storage_path").range(a, b))).map((r) => r.storage_path),
    );
    const missing = photos.filter((p): p is { listing_id: string; storage_path: string } => !!p.storage_path && hasPhotoSizes(p.storage_path) && !hashed.has(p.storage_path));

    let made = 0;
    let failed = 0;
    for (const p of missing.slice(0, limit)) {
      try {
        const read = await readPhoto(admin, p.storage_path, 384);
        if (!read) {
          failed++;
          continue;
        }
        await storeHash(admin, p.listing_id, p.storage_path, await dhashOfImage(read.bytes));
        made++;
      } catch (err) {
        failed++;
        cLog.warn("photo not hashed", { path: p.storage_path, msg: err instanceof Error ? err.message : String(err) });
      }
    }
    const left = missing.length - made;
    if (made || failed) cLog.info(`${made} photo(s) hashed`, { failed, left });
    return NextResponse.json({ ok: true, photos: photos.length, hashed: hashed.size, missing: missing.length, made, failed, left });
  } catch (err) {
    return fail("photo_hashes_failed", 500, err);
  }
}

export const POST = GET;
