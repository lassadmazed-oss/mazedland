/**
 * What a receipt may be — the photo or PDF a payer sends after paying by
 * transfer or D17. Pure, shared by the checkout and the agence request (one
 * form that carries its plan's receipt, 2026-10-31), and tested on its own.
 */

/** Receipts per payment; /api/payments/:id/receipt and /api/pro/shops cap it server-side too. */
export const MAX_RECEIPTS = 3;

// 25 MB raw → modern iPhone photos can be 12-20 MB before compression.
// Images get compressed client-side before upload (final upload typically
// 200-600 KB). PDFs pass through unchanged and the limit is the cap.
export const MAX_RECEIPT_MB = 25;

export const RECEIPT_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/heic",
  "image/heif",
  "application/pdf",
];

const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp", "avif", "heic", "heif"];

/** A PDF passes through untouched; an image is compressed before it goes up. */
export function isPdfReceipt(f: { name: string; type: string }): boolean {
  const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
  return f.type === "application/pdf" || ext === "pdf";
}

/**
 * Whether a picked file can be sent as a receipt. Some mobile pickers report
 * an empty `type` for HEIC files — the extension decides then, so a
 * legitimate photo is not refused.
 */
export function receiptProblem(f: { name: string; type: string; size: number }): null | "format" | "size" {
  const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
  const looksImage = f.type.startsWith("image/") || IMAGE_EXTS.includes(ext);
  if (!looksImage && !isPdfReceipt(f) && !RECEIPT_TYPES.includes(f.type)) return "format";
  if (f.size > MAX_RECEIPT_MB * 1024 * 1024) return "size";
  return null;
}

/**
 * The receipt paths a request names, as the server keeps them: strings,
 * under the payer's own folder of the `receipts` bucket (RLS, 0023), at most
 * MAX_RECEIPTS. Null when one of them is someone else's — a forged request,
 * refused whole rather than trimmed.
 */
export function ownReceiptPaths(raw: unknown, userId: string): string[] | null {
  const list = (Array.isArray(raw) ? raw : [])
    .filter((p): p is string => typeof p === "string" && p.length > 0)
    .slice(0, MAX_RECEIPTS);
  if (!list.every((p) => p.startsWith(`${userId}/`) && !p.includes(".."))) return null;
  return list;
}
