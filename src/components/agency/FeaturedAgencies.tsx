import { getLocale, getTranslations } from "next-intl/server";
import { BadgeCheck, ChevronRight, Store, Zap } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { governorateLabel } from "@/lib/tunisia";
import { delegationLabel } from "@/lib/delegations";
import type { FeaturedShop } from "@/lib/pro/featured";

/**
 * « Agences recommandées »: the strip above the catalogue's annonces. Which
 * agences, and in which order, is src/lib/pro/featured.ts; this only draws
 * them. A server component with nothing to hydrate, and nothing at all when
 * there is no agence to show.
 */
export async function FeaturedAgencies({ shops }: { shops: FeaturedShop[] }) {
  if (shops.length === 0) return null;
  const locale = await getLocale();
  const t = await getTranslations("shops");

  return (
    <section className="mt-6" aria-labelledby="featured-agencies">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="featured-agencies" className="text-[15px] font-extrabold text-foreground">{t("featuredTitle")}</h2>
        <Link href="/agences" className="inline-flex items-center gap-0.5 text-[12.5px] font-bold text-foreground underline-offset-4 hover:underline">
          {t("featuredAll")} <ChevronRight className="size-3.5 rtl:-scale-x-100" strokeWidth={2.4} aria-hidden />
        </Link>
      </div>
      <ul className="snap-rail hide-scrollbar -mx-4 mt-3 flex gap-3 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0">
        {shops.map((s) => (
          <li key={s.id} className="shrink-0 snap-start">
            <Link
              href={`/agences/${s.slug}` as never}
              className="flex w-[248px] items-center gap-3 rounded-2xl border border-border bg-surface p-3 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)] hover:border-foreground/30"
            >
              <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-surface-2 ring-1 ring-border">
                {s.logoPath ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a small logo
                  <img src={propertyPhotoUrl(s.logoPath, { transform: { width: 96, quality: 70 } })} alt="" className="size-full object-cover" loading="lazy" />
                ) : (
                  <Store className="size-5 text-muted" />
                )}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1 truncate text-[13.5px] font-extrabold text-foreground" dir="auto">
                  {s.name}
                  {s.verified && <BadgeCheck className="size-3.5 shrink-0 text-foreground" strokeWidth={2.4} aria-label={t("verified")} />}
                </span>
                <span className="block truncate text-[11.5px] text-muted">
                  {s.city ? `${delegationLabel(s.city, locale)}, ` : ""}{governorateLabel(s.governorate, locale)}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] font-bold text-foreground">
                  {t("listingsCount", { count: s.listings })}
                  {s.reactive && (
                    <span className="mazed-tone-ok inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[10.5px] font-bold leading-tight">
                      <Zap className="size-2.5" strokeWidth={2.6} aria-hidden /> {t("reactiveShort")}
                    </span>
                  )}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
