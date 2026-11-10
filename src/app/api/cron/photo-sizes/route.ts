import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron/auth";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { fail } from "@/lib/http/errors";
import { log } from "@/lib/log";
import { PHOTO_WIDTHS, hasPhotoSizes, photoSizePath } from "@/lib/photoSizes";
import { makePhotoSizes } from "@/lib/photoSizes.server";
import { everyRow, walk } from "@/lib/storage/walk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A photo takes a fraction of a second; a run is capped by `limit`.
export const maxDuration = 300;

const cLog = log.scope("cron-photo-sizes");

const LARGEST = PHOTO_WIDTHS[PHOTO_WIDTHS.length - 1];

/**
 * GET /api/cron/photo-sizes — the sizes of the annonce photos that have none
 * yet (src/lib/photoSizes.ts). They are made when an annonce is saved; this
 * catches what that missed, a photo at a time, and made the sizes of every
 * photo stored before them. Nightly from pg_cron (0216), with the shared
 * secret; `?limit=` (default 100, at most 500) bounds one run.
 *
 * Which photos: those of the annonces and of the edits waiting for a
 * moderator. Which are missing: the widest size is written last, so a photo
 * without it has no complete set.
 */
export async function GET(req: NextRequest) {
  const denied = verifyCronSecret(req);
  if (denied) return denied;
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const limit = Math.min(500, Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 100));
  try {
    const photos = new Set<string>();
    for (const r of await everyRow<{ storage_path: string | null }>((a, b) =>
      admin.from("listing_photos").select("storage_path").order("id").range(a, b),
    )) if (r.storage_path && hasPhotoSizes(r.storage_path)) photos.add(r.storage_path);
    for (const r of await everyRow<{ pending_edit: { photos?: { storage_path?: unknown }[] | null } | null }>((a, b) =>
      admin.from("listings").select("pending_edit").not("pending_edit", "is", null).order("id").range(a, b),
    )) {
      for (const p of r.pending_edit?.photos ?? []) {
        if (typeof p?.storage_path === "string" && hasPhotoSizes(p.storage_path)) photos.add(p.storage_path);
      }
    }

    const stored = new Set((await walk(admin, "properties")).map((o) => o.path));
    // A row whose original is gone has nothing to size from.
    const missing = [...photos].filter((p) => stored.has(p) && !stored.has(photoSizePath(p, LARGEST)));

    let made = 0;
    let failed = 0;
    for (const path of missing.slice(0, limit)) {
      if (await makePhotoSizes(admin, path)) made++;
      else failed++;
    }
    const left = missing.length - made;
    if (made || failed) cLog.info(`${made} photo(s) sized`, { failed, left });
    return NextResponse.json({ ok: true, photos: photos.size, missing: missing.length, made, failed, left });
  } catch (err) {
    return fail("photo_sizes_failed", 500, err);
  }
}

export const POST = GET;
