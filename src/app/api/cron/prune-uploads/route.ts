import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron/auth";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { loadSettings } from "@/lib/settings/server";
import { fail } from "@/lib/http/errors";
import { log } from "@/lib/log";
import { abandonedObjects, referencedPath } from "@/lib/storage/prune";
import { everyRow, walk } from "@/lib/storage/walk";

export const dynamic = "force-dynamic";
// A few hundred objects and a handful of queries; a minute is plenty.
export const maxDuration = 60;

const cLog = log.scope("cron-prune-uploads");

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

const add = (into: Set<string>, bucket: string, value: unknown) => {
  const p = referencedPath(bucket, value);
  if (p) into.add(p);
};

/**
 * Every path a row still names, per bucket. `properties` holds the annonce
 * photos — the live gallery and the one waiting in a seller's pending edit
 * (0172) — the agences' logos and covers, the projects' covers, the ad
 * banners and the guides' covers; `receipts` the payment receipts, first one
 * and full set.
 */
async function referenced(admin: Admin): Promise<{ properties: Set<string>; receipts: Set<string> }> {
  const properties = new Set<string>();
  const receipts = new Set<string>();

  for (const r of await everyRow<{ storage_path: string | null }>((a, b) =>
    admin.from("listing_photos").select("storage_path").order("id").range(a, b),
  )) add(properties, "properties", r.storage_path);

  for (const r of await everyRow<{ pending_edit: { photos?: { storage_path?: unknown }[] | null } | null }>((a, b) =>
    admin.from("listings").select("pending_edit").not("pending_edit", "is", null).order("id").range(a, b),
  )) {
    const photos = r.pending_edit?.photos;
    if (Array.isArray(photos)) for (const p of photos) add(properties, "properties", p?.storage_path);
  }

  for (const r of await everyRow<{ logo_path: string | null; cover_path: string | null }>((a, b) =>
    admin.from("shops").select("logo_path, cover_path").order("id").range(a, b),
  )) {
    add(properties, "properties", r.logo_path);
    add(properties, "properties", r.cover_path);
  }

  for (const r of await everyRow<{ cover_path: string | null }>((a, b) =>
    admin.from("projects").select("cover_path").order("id").range(a, b),
  )) add(properties, "properties", r.cover_path);

  for (const r of await everyRow<{ image_path: string | null; image_mobile_path: string | null }>((a, b) =>
    admin.from("ads").select("image_path, image_mobile_path").order("id").range(a, b),
  )) {
    add(properties, "properties", r.image_path);
    add(properties, "properties", r.image_mobile_path);
  }

  // The guides' covers (0208), drafts included: a cover picked for a guide
  // not yet published is still a cover.
  for (const r of await everyRow<{ cover_path: string | null }>((a, b) =>
    admin.from("articles").select("cover_path").order("id").range(a, b),
  )) add(properties, "properties", r.cover_path);

  for (const r of await everyRow<{ receipt_url: string | null; receipt_urls: string[] | null }>((a, b) =>
    admin.from("payments").select("receipt_url, receipt_urls").order("id").range(a, b),
  )) {
    add(receipts, "receipts", r.receipt_url);
    for (const u of r.receipt_urls ?? []) add(receipts, "receipts", u);
  }

  return { properties, receipts };
}

/** Storage removes a batch at a time. */
const REMOVE_BATCH = 100;

/**
 * GET /api/cron/prune-uploads — the nightly sweep of abandoned uploads
 * (0197): the objects of the `properties` and `receipts` buckets that no row
 * names and that are older than `uploads_prune_days` (/admin/settings).
 * Photos are uploaded while the wizard is open and receipts before the
 * payment is sent, so an upload is a promise of a row; the ones whose row
 * never came, or is gone, only piled up — publicly downloadable, for the
 * photos. Called by pg_cron with the shared secret, like the other drains.
 *
 * The selection is src/lib/storage/prune.ts; this lists and deletes.
 */
export async function GET(req: NextRequest) {
  const denied = verifyCronSecret(req);
  if (denied) return denied;
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const settings = await loadSettings(admin);
  const days = settings.uploads_prune_days;
  try {
    const refs = await referenced(admin);
    const report: Record<string, { objects: number; referenced: number; deleted: number }> = {};
    for (const bucket of ["properties", "receipts"] as const) {
      const objects = await walk(admin, bucket);
      const gone = abandonedObjects(objects, refs[bucket], days);
      let deleted = 0;
      for (let i = 0; i < gone.length; i += REMOVE_BATCH) {
        const batch = gone.slice(i, i + REMOVE_BATCH);
        const { error } = await admin.storage.from(bucket).remove(batch);
        if (error) throw error;
        deleted += batch.length;
      }
      report[bucket] = { objects: objects.length, referenced: refs[bucket].size, deleted };
      if (deleted) cLog.info(`${bucket}: ${deleted} abandoned upload(s) removed`, { days, objects: objects.length });
    }
    return NextResponse.json({ ok: true, days, ...report });
  } catch (err) {
    return fail("prune_uploads_failed", 500, err);
  }
}

export const POST = GET;
