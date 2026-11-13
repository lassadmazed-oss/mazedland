import sharp from "sharp";
import type { getServiceSupabase } from "@/lib/supabase/admin";
import { callJson } from "@/lib/ai/server";
import { log } from "@/lib/log";
import { dhashOfImage, readPhoto, similarPhotos, storeHash } from "@/lib/photoHash.server";
import { ensurePhotoSizes } from "@/lib/photoSizes.server";
import {
  PHOTO_CHECK_SCHEMA, PHOTO_CHECK_SYSTEM, coverKindOf, flagsOf, normalizeFindings, suggestOrder, suggestedCover,
  type PhotoFinding, type PhotoFlag,
} from "./photoCheck";
import type { LeadRow } from "./online";

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

const pLog = log.scope("prospection-photos");

export type PhotoVerdict = {
  path: string;
  finding: PhotoFinding | null;
  flags: PhotoFlag[];
  /** The same picture on another annonce of Mazed Immo. */
  duplicates: { listingId: string; title: string; status: string; distance: number }[];
};

export type PhotoCheckResult = {
  /** Whether the model looked (off, out of budget, or failed: the duplicates were still checked). */
  ai: boolean;
  photos: PhotoVerdict[];
  /** The photos' paths with the best cover first. */
  order: string[];
  /** The path to make the cover, or null when the first photo already is the one. */
  cover: string | null;
};

/** A photo at a width the model can read cheaply, always as WebP and upright. */
async function forTheModel(bytes: Buffer): Promise<string> {
  const out = await sharp(bytes, { failOn: "none" }).rotate().resize({ width: 640, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
  return out.toString("base64");
}

/**
 * Looks at the photos of a lead's annonce: what each one shows and what a
 * person would object to (a phone number, another agency's mark, a face), and
 * whether the picture is already on another annonce. Nothing is changed — the
 * member reads it, and the order it suggests is theirs to apply.
 */
export async function checkLeadPhotos(
  admin: Admin,
  input: { lead: LeadRow; actorId: string },
): Promise<{ ok: true; result: PhotoCheckResult } | { ok: false; error: "no_photos" | "unreadable" }> {
  const { lead } = input;
  if (!lead.listing_id) return { ok: false, error: "no_photos" };
  const { data: rows } = await admin.from("listing_photos").select("storage_path").eq("listing_id", lead.listing_id).order("sort_order");
  const paths = (rows ?? []).map((r) => r.storage_path as string).filter(Boolean);
  if (paths.length === 0) return { ok: false, error: "no_photos" };

  // The pre-made sizes are what is read: make the ones a fresh upload still lacks.
  await ensurePhotoSizes(admin, paths);

  const images: { mediaType: "image/webp"; data: string }[] = [];
  const hashes: (string | null)[] = [];
  for (const path of paths) {
    try {
      const forAi = await readPhoto(admin, path, 640);
      if (!forAi) {
        images.push({ mediaType: "image/webp", data: "" });
        hashes.push(null);
        continue;
      }
      images.push({ mediaType: "image/webp", data: await forTheModel(forAi.bytes) });
      // The hash is made from the same small size the nightly job reads.
      const forHash = await readPhoto(admin, path, 384);
      const hash = await dhashOfImage((forHash ?? forAi).bytes);
      hashes.push(hash);
      await storeHash(admin, lead.listing_id, path, hash);
    } catch (e) {
      pLog.warn("photo not read", { path, msg: e instanceof Error ? e.message : String(e) });
      images.push({ mediaType: "image/webp", data: "" });
      hashes.push(null);
    }
  }
  if (images.every((im) => !im.data)) return { ok: false, error: "unreadable" };

  // One call for all the photos; a photo that could not be read is left out of it.
  const readable = images.map((im, i) => (im.data ? i : -1)).filter((i) => i >= 0);
  let findings: (PhotoFinding | null)[] = paths.map(() => null);
  let ai = false;
  const { data: listing } = await admin.from("listings").select("category:categories (kind)").eq("id", lead.listing_id).maybeSingle();
  const cat = (listing as { category?: { kind?: string } | { kind?: string }[] | null } | null)?.category;
  const kind = coverKindOf((Array.isArray(cat) ? cat[0] : cat)?.kind);

  const call = await callJson({
    admin,
    userId: input.actorId,
    feature: "prospect_photos",
    system: PHOTO_CHECK_SYSTEM,
    user: `Check the ${readable.length} photo(s) above and answer for each one, by its index.`,
    schema: PHOTO_CHECK_SCHEMA as unknown as Record<string, unknown>,
    images: readable.map((i) => images[i]),
    maxTokens: 3_000,
  });
  if (call.ok) {
    ai = true;
    // The model numbered the photos it was shown (0…n−1): back to the lead's own numbering.
    const asked = normalizeFindings(call.data, readable.length);
    asked.forEach((f, n) => {
      if (f) findings[readable[n]] = { ...f, index: readable[n] };
    });
  } else {
    findings = paths.map(() => null);
  }

  // Already on Mazed Immo under another annonce?
  const dup: PhotoVerdict["duplicates"][] = [];
  const listingIds = new Set<string>();
  const similar = await Promise.all(hashes.map((h) => (h ? similarPhotos(admin, h, lead.listing_id) : Promise.resolve([]))));
  similar.forEach((s) => s.forEach((x) => listingIds.add(x.listing_id)));
  const titles = new Map<string, { title: string; status: string }>();
  if (listingIds.size > 0) {
    const { data } = await admin.from("listings").select("id, title, status").in("id", [...listingIds]);
    for (const l of data ?? []) titles.set(l.id as string, { title: l.title as string, status: l.status as string });
  }
  similar.forEach((s) => {
    const seen = new Set<string>();
    dup.push(
      s
        .filter((x) => (seen.has(x.listing_id) ? false : (seen.add(x.listing_id), true)))
        .map((x) => ({ listingId: x.listing_id, title: titles.get(x.listing_id)?.title ?? "—", status: titles.get(x.listing_id)?.status ?? "", distance: x.distance })),
    );
  });

  const photos: PhotoVerdict[] = paths.map((path, i) => ({
    path,
    finding: findings[i],
    duplicates: dup[i] ?? [],
    flags: flagsOf(findings[i], (dup[i] ?? []).length > 0),
  }));
  const order = suggestOrder(findings, photos.map((p) => p.flags), kind);
  const coverIndex = suggestedCover(order);
  return {
    ok: true,
    result: { ai, photos, order: order.map((i) => paths[i]), cover: coverIndex === null ? null : paths[coverIndex] },
  };
}
