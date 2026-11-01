import Image from "next/image";

/**
 * The owner's logo (sent 2026-11-01, « this logo on every page »), in the
 * shapes public/brand holds — made from docs/brand/mazed-logo-source.jpg by
 * scripts/brand-logo.mjs, transparent, the gold as the owner drew it.
 *
 *   - `lockup`: the tower and MAZED side by side. The logo itself is a
 *     portrait — the tower, a rule, MAZED, a rule — and squeezed into a bar
 *     56 px tall its MAZED lands at about nine pixels. Laid out sideways the
 *     same two pieces read at bar height. Every bar uses it.
 *   - `logo`: the whole portrait logo, where there is room (footer, sign-in
 *     card, invoice, 404).
 *   - `mark`: the tower alone, for the smallest places.
 *   - `…OnDark`: the black of the « A » and its gavel turned cream, for a
 *     dark surface, where the black would vanish.
 *
 * Size it by height (`className="h-10 w-auto"`); the width follows.
 */
export const BRAND_FILES = {
  lockup: { src: "/brand/mazed-lockup.webp", width: 371, height: 120 },
  lockupOnDark: { src: "/brand/mazed-lockup-ondark.webp", width: 371, height: 120 },
  logo: { src: "/brand/mazed-logo.webp", width: 363, height: 480 },
  mark: { src: "/brand/mazed-mark.webp", width: 129, height: 160 },
} as const;

export function BrandLogo({
  variant = "lockup",
  className,
  alt = "Mazed Immo",
  eager = false,
}: {
  variant?: keyof typeof BRAND_FILES;
  className?: string;
  /** "" when a link around it already names the site. */
  alt?: string;
  /** Above the fold on every page that shows it: the bars. */
  eager?: boolean;
}) {
  const f = BRAND_FILES[variant];
  return (
    <Image
      src={f.src}
      alt={alt}
      width={f.width}
      height={f.height}
      loading={eager ? "eager" : "lazy"}
      // One small file, made at 3× its largest use: one address, so the bar,
      // the footer and the next page share a single download.
      unoptimized
      draggable={false}
      className={className}
    />
  );
}
