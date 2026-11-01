import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getSettings } from "@/lib/settings/server";
import { publishedGuides } from "@/lib/guides/server";
import { guidesForListing } from "@/lib/guides/articles";
import type { DealType } from "@/lib/listings/deal";
import { GuideCard } from "./GuideCard";
import { ArrowRight } from "lucide-react";

/**
 * « Guides utiles » — a few guides beside an annonce or under the catalogue,
 * picked by what the reader is doing (buying, renting) and what they are
 * looking at (a flat, a plot): src/lib/guides/articles.ts decides, the
 * console's `guides_strip_count` says how many (0 = no strip). Nothing is
 * drawn while no guide is published.
 */
export async function GuidesStrip({
  deal,
  categorySlug,
  via,
  className = "",
}: {
  deal?: DealType | null;
  categorySlug?: string | null;
  /** Where the strip stands, for the count. */
  via: "annonce" | "catalogue" | "home";
  className?: string;
}) {
  const settings = await getSettings();
  if (!settings.guides_enabled || settings.guides_strip_count <= 0) return null;
  const picked = guidesForListing(await publishedGuides(), { deal, categorySlug }, settings.guides_strip_count);
  if (picked.length === 0) return null;
  const t = await getTranslations("guides.strip");

  return (
    <section className={`mt-12 ${className}`} aria-labelledby={`guides-strip-${via}`}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-subtle">{t("eyebrow")}</p>
          <h2 id={`guides-strip-${via}`} className="mazed-h2 mt-1 text-[22px] text-foreground lg:text-[26px]">
            {t("title")}
          </h2>
        </div>
        <Link
          href={"/guides" as never}
          className="inline-flex items-center gap-1 text-[13px] font-bold text-foreground underline-offset-4 hover:underline"
        >
          {t("all")}
          <ArrowRight className="size-3.5 rtl:-scale-x-100" strokeWidth={2.4} aria-hidden />
        </Link>
      </div>
      <ul className={`mt-5 grid gap-x-5 gap-y-7 sm:grid-cols-2 ${picked.length >= 3 ? "lg:grid-cols-3" : ""} ${picked.length >= 4 ? "xl:grid-cols-4" : ""}`}>
        {picked.map((g) => (
          <li key={g.id}>
            <GuideCard guide={g} via={via} compact sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 92vw" />
          </li>
        ))}
      </ul>
    </section>
  );
}
