import Image from "next/image";
import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { formatNumber, formatTND } from "@/lib/utils";
import { Bath, BedDouble, Camera, Home, MapPin, Ruler, Store } from "lucide-react";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { IMAGE_BLUR_MAP } from "@/lib/imageBlurMap";
import { coverPhoto } from "@/lib/listingCover";
import { FavoriteButton } from "@/components/property/FavoriteButton";
import { CompareToggle } from "@/components/compare/CompareToggle";
import { Ltr } from "@/components/ui/Ltr";
import { categoryLabel } from "@/lib/i18n";
import { governorateLabel } from "@/lib/tunisia";
import { shownDelegation } from "@/lib/delegations";
import { asDealType } from "@/lib/listings/deal";

/**
 * One annonce, as a card — the same card on the home rails, in the
 * catalogue and on an agence's page (2026-10-31 redesign).
 *
 * The recipe is the one every property site that reads as premium shares
 * (Zillow, Rightmove, Idealista, Airbnb): the photo is the card, cropped to
 * 4:3 with rounded corners and no chrome around it; what sits ON the photo is
 * only what is read at a glance (« À louer », a paid placement, the heart,
 * how many photos there are); under it the PRICE comes first and biggest,
 * then the title on one line, then the facts a buyer sorts on (type, surface,
 * rooms) and the place. Everything else — the reference, the seller — waits
 * on the annonce's page.
 *
 * The clickable area is a STRETCHED LINK overlay (absolute inset-0), NOT an
 * <a> wrapping the whole card — wrapping nests FavoriteButton's <button>
 * inside an <a> (invalid HTML; breaks assistive tech and hydration). The
 * controls sit above the link via z-index so they stay independently
 * clickable.
 */

export type AnnonceCardRow = {
  id: string;
  title: string;
  price: number | string | null;
  price_on_request: boolean;
  negotiable: boolean;
  governorate: string;
  delegation: string | null;
  /** The MZ- number; not shown on the card, read on the annonce's page. */
  reference?: string | null;
  attributes: Record<string, unknown> | null;
  /** `label_ar` is shown on Arabic pages when the caller's select includes it. */
  category:
    | { label_fr: string; label_ar?: string | null }
    | { label_fr: string; label_ar?: string | null }[]
    | null;
  photos: { storage_path: string; sort_order: number; is_cover?: boolean | null }[] | null;
  /** 0166. Absent on a select that predates it: read as a sale. */
  deal_type?: string | null;
  availability?: string | null;
  /** Paid placements (0156), when the caller's select includes them. */
  promo_home_featured?: boolean | null;
  promo_banner?: boolean | null;
  promo_top_listed?: boolean | null;
  /** Published for an agence (0173), when the caller's select includes it:
   *  the card says so, as Tayara's « Boutique » and Mubawab's logo do. */
  shop_id?: string | null;
};

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

export async function AnnonceCard({
  listing,
  saved = false,
  loggedIn = false,
  priority = false,
  sizes = "(min-width: 1280px) 300px, (min-width: 1024px) 30vw, (min-width: 640px) 45vw, 92vw",
  note = null,
}: {
  listing: AnnonceCardRow;
  /** Pre-resolved favourite membership for this user. Defaults false (anon). */
  saved?: boolean;
  loggedIn?: boolean;
  /** Above the fold (the catalogue's first row): the photo loads eagerly at high priority. */
  priority?: boolean;
  /** The CSS width the photo occupies, for next/image to pick a size. */
  sizes?: string;
  /** A line in amber under the facts — the catalogue's « date non précisée ». */
  note?: string | null;
}) {
  const t = await getTranslations();
  const locale = await getLocale();

  const category = one(listing.category);
  const photos = listing.photos ?? [];
  const cover = coverPhoto(photos);

  const attrs = (listing.attributes ?? {}) as Record<string, unknown>;
  const area = Number(attrs.area_sqm);
  const rooms = Number(attrs.rooms);
  const baths = Number(attrs.bathrooms);
  const where = shownDelegation(listing.governorate, listing.delegation, locale) ?? governorateLabel(listing.governorate, locale);
  const rent = asDealType(listing.deal_type) === "rent";
  const promoted = Boolean(listing.promo_home_featured || listing.promo_banner || listing.promo_top_listed);
  const reserved = listing.availability === "reserved";
  const onRequest = listing.price_on_request || listing.price == null;

  return (
    <article className="group relative">
      <div className="mazed-photo-frame aspect-[4/3]">
        {cover ? (
          <Image
            src={propertyPhotoUrl(cover.storage_path)}
            alt={listing.title}
            fill
            sizes={sizes}
            placeholder={IMAGE_BLUR_MAP[cover.storage_path] ? "blur" : "empty"}
            blurDataURL={IMAGE_BLUR_MAP[cover.storage_path]}
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : undefined}
            className="object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted">
            <Home className="size-8" strokeWidth={1.5} />
          </div>
        )}

        {/* What is read before the price: a paid placement, a rental, a
            reservation. Top-start, where the eye lands first. */}
        {(promoted || rent || reserved || listing.shop_id) && (
          <div className="pointer-events-none absolute start-2.5 top-2.5 z-[2] flex flex-wrap gap-1">
            {promoted && <span className="mazed-chip-photo">{t("listing.promoted")}</span>}
            {rent && <span className="mazed-chip-photo mazed-chip-photo-ink">{t("listing.forRent")}</span>}
            {listing.shop_id && !promoted && (
              <span className="mazed-chip-photo">
                <Store className="size-3" strokeWidth={2.4} aria-hidden /> {t("listing.shopLabel")}
              </span>
            )}
            {reserved && (
              <span className="mazed-chip-photo" style={{ background: "rgba(245, 158, 11, 0.95)", color: "#1c1917" }}>
                {t("listing.reserved")}
              </span>
            )}
          </div>
        )}

        {/* How many photos there are to see — the one thing a buyer asks of a
            card before opening it. */}
        {photos.length > 1 && (
          <span className="mazed-chip-photo mazed-chip-photo-ink pointer-events-none absolute bottom-2.5 end-2.5 z-[2]">
            <Camera className="size-3" strokeWidth={2.4} aria-hidden />
            <span className="mazed-tabular">{photos.length}</span>
            <span className="sr-only">{t("listing.gallery.photos", { count: photos.length })}</span>
          </span>
        )}
      </div>

      {/* The heart and the comparison, top-end. z-20 keeps them ABOVE the
          stretched link (z-10) so their buttons still receive clicks. */}
      <div className="absolute end-2.5 top-2.5 z-20 flex items-center gap-1.5">
        <CompareToggle listingId={listing.id} />
        <FavoriteButton listingId={listing.id} initialSaved={saved} loggedIn={loggedIn} size="sm" />
      </div>

      {/* BODY — naked, on the page. The price first. */}
      <div className="pt-3">
        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          {onRequest ? (
            <span className="text-[15px] font-extrabold text-foreground">{t("listing.priceOnRequest")}</span>
          ) : (
            <span dir="ltr" className="mazed-tabular inline-flex items-baseline gap-1 text-[17px] font-extrabold leading-none text-foreground">
              {formatTND(Number(listing.price), locale)}
              <span className="text-[11px] font-bold text-muted">{rent ? t("listing.tndPerMonth") : t("common.tnd")}</span>
            </span>
          )}
          {listing.negotiable && !onRequest && (
            <span className="text-[11px] font-semibold text-muted">{t("listing.negotiable")}</span>
          )}
        </div>

        {/* dir="auto" lets the title's first strong directional character
            pick the truncation side: Latin titles ellipsis at the right,
            Arabic titles at the left. */}
        <h3 dir="auto" className="mt-1.5 line-clamp-1 text-[14px] font-semibold leading-snug text-foreground">
          {listing.title}
        </h3>

        {/* The line that decides whether the card is worth opening. */}
        <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12.5px] text-muted">
          {category && <span>{categoryLabel(category, locale)}</span>}
          {Number.isFinite(area) && area > 0 && (
            <span className="mazed-tabular inline-flex items-center gap-1">
              <Ruler className="size-3" strokeWidth={2} aria-hidden />
              {t("listing.areaValue", { area: formatNumber(area, locale) })}
            </span>
          )}
          {Number.isFinite(rooms) && rooms > 0 && (
            <span className="mazed-tabular inline-flex items-center gap-1">
              <BedDouble className="size-3" strokeWidth={2} aria-hidden />
              {/* Tunisian shorthand, written in Latin in both languages.
                  Isolated so RTL does not turn "S+3" into "3+S". */}
              <Ltr>S+{rooms}</Ltr>
            </span>
          )}
          {Number.isFinite(baths) && baths > 0 && (
            <span className="mazed-tabular inline-flex items-center gap-1">
              <Bath className="size-3" strokeWidth={2} aria-hidden />
              {t("catalogue.specBathrooms", { count: baths })}
            </span>
          )}
        </p>
        <p className="mt-0.5 flex items-center gap-1 text-[12px] text-muted">
          <MapPin className="size-3 shrink-0" strokeWidth={2} aria-hidden />
          <span className="truncate">{where}</span>
        </p>
        {note && <p className="mt-1 text-[11px] font-semibold text-amber-600">{note}</p>}
      </div>

      {/* Stretched link — the whole card is clickable without wrapping the
          interactive heart in an <a>. z-10 sits under the controls' z-20. */}
      <Link
        href={`/annonces/${listing.id}` as "/annonces"}
        aria-label={listing.title}
        className="absolute inset-0 z-10 rounded-2xl"
      >
        <span className="sr-only">{listing.title}</span>
      </Link>
    </article>
  );
}
