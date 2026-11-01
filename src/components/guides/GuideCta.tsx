import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { isRtl } from "@/lib/i18n";
import { CTA_HREF, type GuideCta as Kind } from "@/lib/guides/articles";
import { ArrowRight } from "lucide-react";

/**
 * The band that closes a guide: the reader has learnt how to do the thing,
 * here is where to do it — the annonces for sale, the rentals, or the publish
 * form when the guide is for sellers (src/lib/guides/articles.ts, ctaFor). The
 * home page's one dark block, in the same vocabulary (SellBand).
 */
export async function GuideCta({ kind }: { kind: Kind }) {
  const t = await getTranslations("guides.cta");
  const arabic = isRtl(await getLocale()) ? "font-arabic" : "";
  return (
    <section className="mt-12" aria-labelledby="guide-cta">
      <div className="mazed-band-ink relative overflow-hidden rounded-[var(--radius-3xl)] px-6 py-10 lg:px-14 lg:py-14">
        <div className="relative max-w-2xl">
          <h2 id="guide-cta" className={`mazed-h2 text-[26px] text-[var(--background)] lg:text-[36px] ${arabic}`}>
            {t(`${kind}.title`)}
          </h2>
          <p className={`mt-3 max-w-xl text-[14px] leading-relaxed text-white/75 lg:text-[16px] ${arabic}`}>{t(`${kind}.body`)}</p>
          <Link
            href={CTA_HREF[kind] as never}
            className="tap-target mt-6 inline-flex h-12 items-center gap-2 rounded-full bg-[var(--background)] px-6 text-[14px] font-extrabold text-foreground transition hover:bg-surface-2 active:scale-[0.98]"
          >
            {t(`${kind}.button`)}
            <ArrowRight className="size-4 rtl:-scale-x-100" strokeWidth={2.5} aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}
