import { hasPhotoSizes, photoSizePath, photoWidthFor } from "./photoSizes";

/**
 * Resolve a storage path (bucket-relative) to a public URL on the
 * Supabase storage CDN. We don't go through `storage.from(...).getPublicUrl`
 * here so we can construct URLs in server components without a client
 * round-trip; the format is stable.
 */
export function propertyPhotoUrl(
  storagePath: string,
  opts: { bucket?: string; transform?: { width?: number; quality?: number } } = {},
): string {
  // Pass-through for fully-qualified URLs (Unsplash seed data, externally
  // hosted images) and absolute paths into /public. The Supabase prefix
  // logic only kicks in for bucket-relative paths like
  // `<userId>/photo-1234.jpg`, which is what real uploads produce.
  if (storagePath.startsWith("http://") || storagePath.startsWith("https://")) {
    return storagePath;
  }
  if (storagePath.startsWith("/")) return storagePath;

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return "/placeholder.jpg";
  const bucket = opts.bucket ?? "properties";
  if (opts.transform?.width || opts.transform?.quality) {
    const params = new URLSearchParams();
    if (opts.transform.width) params.set("width", String(opts.transform.width));
    if (opts.transform.quality) params.set("quality", String(opts.transform.quality));
    // A width alone with Supabase's default « cover » keeps the original height
    // and crops to a strip; « contain » scales the whole photo (src/lib/imageLoader.ts).
    params.set("resize", "contain");
    return `${base}/storage/v1/render/image/public/${bucket}/${storagePath}?${params}`;
  }
  return `${base}/storage/v1/object/public/${bucket}/${storagePath}`;
}

/**
 * An annonce photo at a width, for a plain `<img>`: its size made in advance
 * (src/lib/photoSizes.ts), not Supabase's paid resizer. Only for annonce
 * photos — the agences' logos and covers come through the same uploader but
 * have no sizes made, and keep `propertyPhotoUrl(…, { transform })`.
 */
export function annoncePhotoUrl(storagePath: string, width: number, quality = 70): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (base && hasPhotoSizes(storagePath)) {
    return `${base}/storage/v1/object/public/properties/${photoSizePath(storagePath, photoWidthFor(width))}`;
  }
  return propertyPhotoUrl(storagePath, { transform: { width, quality } });
}
