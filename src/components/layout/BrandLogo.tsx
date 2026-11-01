import Image from "next/image";

/**
 * The owner's logo, exactly as they sent it: the tower above, MAZED between
 * its two gold rules below. Made from docs/brand/mazed-logo-source.jpg by
 * scripts/brand-logo.mjs, transparent, the gold as the owner drew it.
 *
 * Never recompose it. A first version (2026-11-01) laid the tower and MAZED
 * side by side for the bars; the owner turned it down: « صلحه كيف ما بعثته
 * لك ». Every bar is tall enough for the logo as it is (--topbar-h,
 * --desktop-nav-h in globals.css).
 *
 *   - `logo`: everywhere on a light surface.
 *   - `logoOnDark`: on a photo or a dark surface, where the black of the
 *     « A » and its gavel would vanish (turned cream).
 *
 * Size it by height (`className="h-12 w-auto"`); the width follows.
 */
export const BRAND_FILES = {
  logo: { src: "/brand/mazed-logo.webp", width: 269, height: 360 },
  logoOnDark: { src: "/brand/mazed-logo-ondark.webp", width: 179, height: 240 },
} as const;

export function BrandLogo({
  variant = "logo",
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
