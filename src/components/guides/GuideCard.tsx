import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { formatDate } from "@/lib/utils";
import { summaryText, type ArticleSummary } from "@/lib/guides/articles";
import { ArrowRight, BookOpen } from "lucide-react";

/**
 * One guide as a card — on /guides, under a guide (« Guides liés ») and in the
 * strips beside annonces. The AnnonceCard's recipe: the cover is the card, no
 * chrome around it; then the first tag, the title, the excerpt and the date.
 * A stretched link makes the whole card the target, and the tap is counted
 * (`guide_open`, with where it came from).
 */
export async function GuideCard({
  guide,
  via,
  priority = false,
  sizes = "(min-width: 1280px) 380px, (min-width: 1024px) 30vw, (min-width: 640px) 45vw, 92vw",
  compact = false,
}: {
  guide: ArticleSummary;
  /** Where the card stands, for the count: index, related, annonce, catalogue. */
  via: string;
  priority?: boolean;
  sizes?: string;
  /** The strip's smaller card: a tighter title, no excerpt. */
  compact?: boolean;
}) {
  const t = await getTranslations("guides");
  const locale = await getLocale();
  const shown = summaryText(guide, locale);
  const date = guide.published_at ? formatDate(guide.published_at, locale, "medium") : null;
  const tag = guide.tags[0];

  return (
    <article className="group relative flex h-full flex-col">
      <div className={`mazed-photo-frame ${compact ? "aspect-[16/10]" : "aspect-[16/10]"}`}>
        {guide.cover_path ? (
          <Image
            src={propertyPhotoUrl(guide.cover_path)}
            alt=""
            fill
            sizes={sizes}
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : undefined}
            className="object-cover transition duration-500 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="mazed-band-warm flex h-full items-center justify-center text-foreground/40">
            <BookOpen className="size-9" strokeWidth={1.4} aria-hidden />
          </div>
        )}
        {(tag || shown.missing) && (
          <div className="pointer-events-none absolute start-2.5 top-2.5 z-[2] flex flex-wrap gap-1">
            {tag && <span className="mazed-chip-photo">{t(`tags.${tag}`)}</span>}
            {shown.missing && <span className="mazed-chip-photo mazed-chip-photo-ink">{t(`cardLang.${shown.lang}`)}</span>}
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col pt-3">
        {date && <p className="text-[12px] font-semibold text-muted">{date}</p>}
        <h3
          dir="auto"
          lang={shown.lang}
          className={`mt-1 line-clamp-2 font-extrabold leading-snug text-foreground ${compact ? "text-[15px]" : "text-[17px]"} ${shown.lang === "ar" ? "font-arabic" : ""}`}
        >
          {shown.title}
        </h3>
        {!compact && shown.excerpt && (
          <p dir="auto" lang={shown.lang} className={`mt-1.5 line-clamp-3 text-[13.5px] leading-relaxed text-muted ${shown.lang === "ar" ? "font-arabic" : ""}`}>
            {shown.excerpt}
          </p>
        )}
        <p className="mt-auto flex items-center gap-1 pt-3 text-[13px] font-bold text-foreground">
          {t("readGuide")}
          <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" strokeWidth={2.4} aria-hidden />
        </p>
      </div>

      <Link
        href={`/guides/${guide.slug}` as never}
        aria-label={shown.title}
        data-track="guide_open"
        data-track-via={via}
        data-track-slug={guide.slug}
        className="absolute inset-0 z-10 rounded-2xl"
      >
        <span className="sr-only">{shown.title}</span>
      </Link>
    </article>
  );
}
