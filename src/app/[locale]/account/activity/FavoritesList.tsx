"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ListingImage } from "@/components/media/ListingImage";
import { FavoriteButton } from "@/components/property/FavoriteButton";
import { formatTND } from "@/lib/utils";
import { Heart, Home, MapPin, Search } from "lucide-react";

/** One saved annonce, with its words already in the page's language. */
export type SavedItem = {
  id: string;
  title: string;
  category: string;
  place: string;
  price: number | null;
  priceOnRequest: boolean;
  rent: boolean;
  coverPath: string | null;
  /** No longer published: kept in the list, marked « plus disponible ». */
  gone: boolean;
  /** Taken down by the console: kept too, but with none of its words, price or photo. */
  withheld: boolean;
};

/**
 * The favourites themselves — the list, its count and its empty state.
 *
 * A client component so that removing a favourite shows at once. The page
 * used to be all server-rendered: « Retirer des favoris » emptied the heart
 * but the card stayed and the count still said 1 until the page was left and
 * opened again. Now the card goes on the tap, the count and the empty state
 * follow, and if the write fails the heart rolls back (FavoriteButton says
 * why in a toast) and the card comes back where it was.
 *
 * The cards are the catalogue's (2026-10-31): the photo at 4:3 with what is
 * read at a glance on it, then the price first, the title, the type and the
 * place — so a saved annonce looks like the thing that was saved, on a phone
 * as on a desktop. `phoneCols` is the catalogue's `catalogue_phone_columns`.
 */
export function FavoritesList({ items, phoneCols = 1 }: { items: SavedItem[]; phoneCols?: number }) {
  const t = useTranslations("account.favorites");
  const tRoot = useTranslations();
  const locale = useLocale();
  // Ids taken off on this page. Filtering keeps the order, so a card that
  // comes back after a failed write lands in its old place.
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const visible = items.filter((i) => !removed.has(i.id));

  const follow = (id: string) => (saved: boolean) =>
    setRemoved((prev) => {
      const next = new Set(prev);
      if (saved) next.delete(id);
      else next.add(id);
      return next;
    });

  const priceLabel = (i: SavedItem) =>
    i.priceOnRequest || i.price == null
      ? t("priceOnRequest")
      : t(i.rent ? "pricePerMonth" : "price", { amount: formatTND(i.price, locale) });

  return (
    <>
      <header>
        <h1 className="mazed-h2 inline-flex items-center gap-2.5 text-[26px] text-foreground lg:text-[32px]">
          <Heart className="size-6 shrink-0" strokeWidth={2.2} aria-hidden /> {t("title")}
        </h1>
        {/* Polite live region: a screen reader hears the new count when a
            card leaves, since the card itself just disappears. */}
        <p className="mt-1 text-[13.5px] text-muted" aria-live="polite">
          {visible.length === 0 ? t("subtitleEmpty") : t("subtitleCount", { count: visible.length })}
        </p>
      </header>

      {visible.length === 0 ? (
        <div className="mazed-band-warm mt-6 rounded-[var(--radius-3xl)] px-6 py-12 text-center lg:py-16">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-surface text-foreground shadow-[var(--shadow-card)]">
            <Heart className="size-5" strokeWidth={2.2} aria-hidden />
          </span>
          <p className="mx-auto mt-4 max-w-sm text-[14px] leading-relaxed text-muted">{t("emptyBody")}</p>
          <Link
            href={"/annonces" as never}
            className="mazed-btn-luxe tap-target mt-6 inline-flex h-12 items-center gap-2 rounded-full px-6 text-[14px]"
          >
            <Search className="size-4" aria-hidden /> {t("browse")}
          </Link>
        </div>
      ) : (
        <ul
          className={`mt-5 grid gap-x-3 gap-y-7 ${
            phoneCols === 2 ? "grid-cols-2" : "grid-cols-1"
          } sm:grid-cols-2 lg:grid-cols-3 lg:gap-x-5 lg:gap-y-9 xl:grid-cols-4`}
        >
          {visible.map((i) => {
            const title = i.withheld ? t("withheldTitle") : i.title;
            return (
              <li key={i.id}>
                <article className={`group relative ${i.gone ? "opacity-80" : ""}`}>
                  <div className="mazed-photo-frame aspect-[4/3]">
                    {i.coverPath && !i.withheld ? (
                      <ListingImage
                        path={i.coverPath}
                        alt=""
                        sizes="(min-width: 1280px) 300px, (min-width: 1024px) 30vw, (min-width: 640px) 45vw, 92vw"
                        fit="cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-muted">
                        <Home className="size-8" strokeWidth={1.5} aria-hidden />
                      </div>
                    )}
                    {i.rent && !i.withheld && (
                      <div className="pointer-events-none absolute start-2.5 top-2.5 z-[2]">
                        <span className="mazed-chip-photo mazed-chip-photo-ink">{tRoot("listing.forRent")}</span>
                      </div>
                    )}
                    {/* « plus disponible », on the photo where « À louer » would be read. */}
                    {i.gone && (
                      <span className="mazed-chip-photo mazed-chip-photo-ink pointer-events-none absolute bottom-2.5 start-2.5 z-[2]">
                        {t("unavailable")}
                      </span>
                    )}
                  </div>

                  {/* The heart stays on the card: this page is where people come
                      to REMOVE things, and hunting for that control is the one
                      thing it must not make you do. z-20 keeps it above the
                      stretched link. */}
                  <div className="absolute end-2.5 top-2.5 z-20">
                    <FavoriteButton listingId={i.id} initialSaved loggedIn size="sm" onSavedChange={follow(i.id)} />
                  </div>

                  <div className="pt-3">
                    {i.withheld ? (
                      <>
                        <p className="text-[15px] font-extrabold text-foreground">{title}</p>
                        <p className="mt-1 text-[12.5px] font-semibold text-[var(--accent-deep)]">{t("unavailable")}</p>
                      </>
                    ) : (
                      <>
                        <p className="mazed-tabular text-[17px] font-extrabold leading-none text-foreground">{priceLabel(i)}</p>
                        <h2 dir="auto" className="mt-1.5 line-clamp-1 text-[14px] font-semibold leading-snug text-foreground">
                          {title}
                        </h2>
                        <p className="mt-1 text-[12.5px] text-muted">{i.category}</p>
                        <p className="mt-0.5 flex items-center gap-1 text-[12px] text-muted">
                          <MapPin className="size-3 shrink-0" strokeWidth={2} aria-hidden />
                          <span className="truncate">{i.place}</span>
                        </p>
                      </>
                    )}
                  </div>

                  {/* Stretched link — the whole card opens the annonce without
                      wrapping the heart's <button> in an <a>. */}
                  <Link href={`/annonces/${i.id}` as never} aria-label={title} className="absolute inset-0 z-10 rounded-2xl">
                    <span className="sr-only">{title}</span>
                  </Link>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
