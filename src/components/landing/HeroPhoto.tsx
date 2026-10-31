import { EMPTY_GIF } from "@/components/ui/HiddenAt";

/**
 * The home page's own photograph — the white house, the blue door, the palm
 * and the sea that already open the sign-in page. A property site's first
 * screen is a photograph everywhere it is done well (Rightmove, Bayut,
 * Property Finder); the catalogue's own photos cannot be that photograph,
 * because a seller's phone shot is not a brand.
 *
 * `hiddenAt` is the media query at which CSS hides the tree this sits in
 * (the home renders a phone tree and a desktop tree): the first <source>
 * hands that width an empty GIF, so the hidden copy is never downloaded
 * (see HiddenAt). The visible copy loads eagerly at high priority — it is
 * the page's largest paint.
 */
export function HeroPhoto({ hiddenAt, className = "" }: { hiddenAt: string; className?: string }) {
  return (
    <picture className={className}>
      <source media={hiddenAt} srcSet={EMPTY_GIF} />
      <source srcSet="/auth-hero.avif" type="image/avif" />
      <source
        srcSet="/auth-hero.w640.webp 640w, /auth-hero.w828.webp 828w, /auth-hero.webp 1100w"
        sizes="100vw"
        type="image/webp"
      />
      <img
        src="/auth-hero.webp"
        alt=""
        fetchPriority="high"
        decoding="async"
        className="h-full w-full object-cover object-[50%_62%]"
      />
    </picture>
  );
}
