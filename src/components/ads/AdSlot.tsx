import { getLocale } from "next-intl/server";
import { getSettings } from "@/lib/settings/server";
import { liveAds } from "@/lib/ads/server";
import { adAlt, type AdPlacement } from "@/lib/ads/ads";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { AdRotator, type Banner } from "./AdRotator";

/**
 * An advertising space: `<AdSlot placement="catalogue" />`.
 *
 * Nothing at all when the spaces are switched off (`feature_ads`) or no
 * campaign is running there — not an empty box, not a « votre publicité
 * ici »: a gap in the page reads as something that failed to load.
 *
 * `as` and `className` dress the wrapper, which only exists when there is a
 * banner: in a grid of cards the slot is an `<li>` spanning the row, and an
 * empty `<li>` would still take its place in the grid.
 */
export async function AdSlot({ placement, ...slot }: { placement: AdPlacement } & SlotProps) {
  return <AdBanners banners={await slotBanners(placement)} {...slot} />;
}

type SlotProps = {
  as?: "div" | "li" | "section";
  className?: string;
  /** The width the slot takes, for the image variant (next/image `sizes`). */
  sizes?: string;
};

/** The banners a placement shows now: none when the spaces are off or no campaign runs there. */
export async function slotBanners(placement: AdPlacement): Promise<Banner[]> {
  const settings = await getSettings();
  if (!settings.feature_ads) return [];
  const ads = await liveAds(placement);
  if (ads.length === 0) return [];

  const locale = await getLocale();
  return ads.map((ad) => ({
    id: ad.id,
    alt: adAlt(ad, locale),
    src: propertyPhotoUrl(ad.image_path),
    mobileSrc: ad.image_mobile_path ? propertyPhotoUrl(ad.image_mobile_path) : null,
  }));
}

/**
 * An advertising space whose banners the page has already read
 * (`slotBanners`). A page cached on the CDN reads all its slots before it
 * renders: two `<AdSlot>`s each wait on their own query, and the page's code
 * comes out in whichever order the database answers.
 */
export function AdBanners({ banners, as: Tag = "div", className, sizes }: { banners: Banner[] } & SlotProps) {
  if (banners.length === 0) return null;
  return (
    <Tag className={className}>
      <AdRotator banners={banners} sizes={sizes} />
    </Tag>
  );
}
