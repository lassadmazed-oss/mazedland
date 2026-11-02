import type { ReactNode } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { AuthHeroPanel } from "@/components/auth/AuthHeroPanel";
import { BrandLogo } from "@/components/layout/BrandLogo";
import { HeroPhoto } from "@/components/landing/HeroPhoto";
import { LG_UP } from "@/components/ui/HiddenAt";

/**
 * The frame of the four auth screens (login, signup, forgot, reset), in the
 * vocabulary of the 2026-10-31 redesign.
 *
 *   - Phone (< lg): the brand photograph with the title over it — the home
 *     page's own hero — and the form floating off its lower edge, the way the
 *     search card does. The fixed « Accueil » pill (MobileShell) sits on the
 *     photo's top corner, so the title starts under it.
 *   - Desktop (lg+): the split screen — the photo panel with the trust
 *     points, the form in a floating card.
 *
 * `children` is the form; `below` goes under it inside the card (« Mot de
 * passe oublié ? »); `footer` is the line that swaps to the other screen.
 */
export async function AuthScreen({
  title,
  desktopTitle,
  intro,
  children,
  below,
  footer,
  labelledBy,
}: {
  title: ReactNode;
  /** The desktop card's heading, when it says more than the phone's (« Bienvenue sur Mazed Immo »). */
  desktopTitle?: ReactNode;
  intro?: string;
  children: ReactNode;
  below?: ReactNode;
  footer?: ReactNode;
  /** The id of the page's heading, for aria-labelledby. */
  labelledBy: string;
}) {
  const t = await getTranslations("brand");
  const locale = await getLocale();
  const arabic = locale === "ar" ? "font-arabic" : "";

  return (
    <>
      {/* ── MOBILE / tablet (< lg) — the photo, the form floating off it ── */}
      <div className="lg:hidden">
        <section className="relative overflow-hidden bg-[#1b2a36]" aria-labelledby={labelledBy}>
          <HeroPhoto hiddenAt={LG_UP} className="absolute inset-0" />
          <div className="mazed-hero-scrim absolute inset-0" aria-hidden />
          <div className="relative px-5 pb-14 pt-[4.5rem] text-white">
            {/* The logo on the photo: its dark-surface file (the « A » and
                the gavel in cream) on a smoked-glass tile, so the gold holds
                over the white walls of the picture. */}
            <p className="inline-flex rounded-2xl bg-black/40 p-2.5 ring-1 ring-white/20 backdrop-blur-sm">
              <BrandLogo variant="logoOnDark" alt={t("name")} eager className="h-16 w-auto" />
            </p>
            <h1 id={labelledBy} className={`mazed-display mt-3 max-w-[14ch] text-[30px] text-white drop-shadow-sm ${arabic}`}>
              {title}
            </h1>
            {intro && <p className={`mt-2.5 max-w-sm text-[13.5px] leading-snug text-white/85 ${arabic}`}>{intro}</p>}
          </div>
        </section>

        <div className="relative z-10 -mt-8 px-4 pb-10">
          <div className="mazed-float p-5">
            {children}
            {below}
          </div>
          {footer && <div className="mt-5 text-center text-[13px] text-muted">{footer}</div>}
        </div>
      </div>

      {/* ── DESKTOP (lg+) — one-screen split: the photo + the card ── */}
      <div className="hidden h-[100dvh] overflow-hidden lg:grid lg:grid-cols-[1.05fr_0.95fr]">
        <AuthHeroPanel />

        <div className="relative flex h-[100dvh] items-center justify-center overflow-y-auto bg-paper-warm px-8 py-10">
          <div className="mazed-float w-full max-w-md p-8">
            <div className="flex flex-col items-center text-center">
              <BrandLogo variant="logo" alt={t("name")} eager className="h-24 w-auto" />
              {/* Each tree has its own heading, as every split page here does:
                  CSS shows one tree, and only that one's heading is read. */}
              <h1 className={`mazed-h2 mt-5 text-[26px] text-foreground ${arabic}`}>{desktopTitle ?? title}</h1>
              {intro && <p className="mt-2 text-[13px] leading-relaxed text-muted">{intro}</p>}
            </div>

            <div className="mt-7">{children}</div>
            {below}
            {footer && <div className="mt-6 text-center text-[13px] text-muted">{footer}</div>}
          </div>
        </div>
      </div>
    </>
  );
}
