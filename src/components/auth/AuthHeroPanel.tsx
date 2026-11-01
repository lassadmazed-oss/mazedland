import { ShieldCheck, Eye, Zap, Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { BELOW_LG, EMPTY_GIF } from "@/components/ui/HiddenAt";

/**
 * Desktop-only half of the auth screens: the brand photograph that opens the
 * home page (2026-10-31), under the home hero's own scrim, with the promise,
 * three trust points and a slim social-proof line set directly on it — kept
 * compact so the whole auth screen fits in one viewport without scrolling.
 * Rendered only inside the `hidden lg:grid` tree. That hides it on phones
 * but does not stop the photo downloading, so the first <source> hands narrow
 * screens an empty GIF (see HiddenAt); the phone tree draws the same photo
 * with HeroPhoto.
 */
const FEATURES = [
  { Icon: ShieldCheck, key: "secure" },
  { Icon: Eye,         key: "transparency" },
  { Icon: Zap,         key: "simple" },
] as const;

export function AuthHeroPanel() {
  const t = useTranslations("auth.hero");
  return (
    <div className="relative h-full w-full overflow-hidden bg-[#1b2a36]">
      <picture>
        <source media={BELOW_LG} srcSet={EMPTY_GIF} />
        <source srcSet="/auth-hero.avif" type="image/avif" />
        <source srcSet="/auth-hero.webp" type="image/webp" />
        <img
          src="/auth-hero.webp"
          alt=""
          fetchPriority="high"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover object-[50%_62%]"
        />
      </picture>
      {/* The home hero's scrim, and a little more at the foot: three lines of
          small white type sit there. */}
      <div className="mazed-hero-scrim absolute inset-0" aria-hidden />
      <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/55 to-transparent" aria-hidden />

      <div className="relative flex h-full flex-col justify-between p-12 text-white">
        {/* Top — one brand pill, as on the home page. */}
        <span className="inline-flex w-fit items-center gap-2 rounded-full bg-black/30 px-3.5 py-1.5 text-[12px] font-bold ring-1 ring-white/25 backdrop-blur-sm">
          <ShieldCheck className="size-4 shrink-0" strokeWidth={2.2} aria-hidden />
          {t("badge")}
        </span>

        {/* Bottom — headline + trust points + social proof */}
        <div>
          <h2 className="mazed-display max-w-[14ch] text-[44px] text-white drop-shadow-sm">{t("title")}</h2>

          <ul className="mt-8 space-y-3.5">
            {FEATURES.map((f) => (
              <li key={f.key} className="flex items-center gap-3.5">
                <span className="inline-grid size-10 shrink-0 place-items-center rounded-full bg-white/14 ring-1 ring-white/25 backdrop-blur-sm">
                  <f.Icon className="size-[18px]" strokeWidth={2} aria-hidden />
                </span>
                <div>
                  <div className="text-[14px] font-bold leading-tight">{t(`${f.key}Title`)}</div>
                  <div className="mt-0.5 text-[12px] text-white/70">{t(`${f.key}Sub`)}</div>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-8 flex items-center gap-3">
            {/* Tailwind 4's space-x is margin-inline-start/end, so the overlap
                already mirrors under RTL. Neutral tones: the page has one accent. */}
            <div className="flex -space-x-2.5">
              {["#e4e4e7", "#a1a1aa", "#52525b", "#f4f4f5"].map((c, i) => (
                <span key={i} aria-hidden className="size-8 rounded-full ring-2 ring-black/40" style={{ background: c }} />
              ))}
            </div>
            <div className="leading-tight">
              <div className="text-[12.5px] font-extrabold">{t("users")}</div>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className="flex gap-0.5" aria-hidden>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className="size-3 fill-white text-white" strokeWidth={0} />
                  ))}
                </span>
                <span className="text-[11px] text-white/70">{t("trust")}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
