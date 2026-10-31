"use client";

import { getBrowserSupabase } from "@/lib/supabase/client";
import { compressImage } from "@/lib/imageCompress";
import { isPdfReceipt } from "./receipts";

/**
 * A call that never answers is a spinner forever. On 2026-10-28 a receipt
 * stayed « sending » until a reload: the Supabase client had deadlocked on its
 * own lock (AccountMenu). After `ms` the call fails like a lost connection:
 * the toast says so and the button lets the client try again.
 */
export function withTimeout<P extends PromiseLike<unknown>>(p: P, ms: number): Promise<Awaited<P>> {
  return new Promise<Awaited<P>>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("timeout")), ms);
    Promise.resolve(p).then(
      (v) => { clearTimeout(id); resolve(v as Awaited<P>); },
      (e) => { clearTimeout(id); reject(e); },
    );
  });
}

export type ReceiptUpload =
  | { ok: true; paths: string[] }
  /** session: signed out meanwhile · upload: storage refused a file · network: gave up halfway. */
  | { ok: false; reason: "session" | "upload" | "network" };

/**
 * Puts the receipts in the `receipts` bucket, under the payer's own folder
 * (RLS, 0023) and named after the payment — `<uid>/<paymentId>-<time>-<i>`.
 * Images are compressed first (document-tier WebP, ~250-500 KB, text stays
 * crisp; HEIC becomes WebP even when the picker reports no type); PDFs go as
 * they are. A send that fails halfway leaves nothing behind in the bucket.
 * The caller attaches the paths, and calls `removeReceipts` if that fails.
 */
export async function uploadReceipts(files: readonly File[], paymentId: string): Promise<ReceiptUpload> {
  const supabase = getBrowserSupabase();
  const uploaded: string[] = [];
  try {
    const { data: auth } = await withTimeout(supabase.auth.getUser(), 10_000);
    if (!auth.user) return { ok: false, reason: "session" };
    const safePid = paymentId.replace(/[^a-z0-9-]/gi, "");
    for (let i = 0; i < files.length; i++) {
      const original = files[i];
      let toUpload = original;
      if (!isPdfReceipt(original)) {
        try {
          toUpload = await compressImage(original, { maxEdge: 2000, quality: 0.86, format: "webp" });
        } catch {
          toUpload = original;
        }
      }
      // The index suffix keeps the three apart.
      const ext = toUpload.name.split(".").pop()?.toLowerCase() ?? "bin";
      const path = `${auth.user.id}/${safePid}-${Date.now()}-${i}.${ext}`;
      // A receipt is a few hundred KB after compression; a slow phone line
      // gets 90 s before it is told the send failed.
      const { error } = await withTimeout(
        supabase.storage.from("receipts").upload(path, toUpload, { cacheControl: "3600", upsert: false, contentType: toUpload.type }),
        90_000,
      );
      if (error) {
        removeReceipts(uploaded);
        return { ok: false, reason: "upload" };
      }
      uploaded.push(path);
    }
    return { ok: true, paths: uploaded };
  } catch {
    removeReceipts(uploaded);
    return { ok: false, reason: "network" };
  }
}

/** Takes back receipts a request could not attach: no orphan left in the bucket. */
export function removeReceipts(paths: readonly string[]): void {
  if (paths.length) void getBrowserSupabase().storage.from("receipts").remove([...paths]);
}
