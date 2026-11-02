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
 * ONE tree, not a phone tree and a desktop tree. The form is a client
 * component with ids of its own (« signup-accept », « login-error ») and
 * timers of its own (the OTP cooldown, the recovery listener): mounted twice,
 * the ids were duplicated and on a desktop the « J'accepte » label toggled
 * the hidden phone copy's checkbox while the visible one stayed unchecked.
 * Only the chrome around the form differs per breakpoint, and CSS hides the
 * copy that is not for this width.
 *
 * `children` is the form; `below` goes under it inside the card (« Mot de
 * passe oublié ? »); `footer` is the line that swaps to the other screen.
 */
const TITLE_ID = "auth-title";

export async function AuthScreen({
  title,
  desktopTitle,
  intro,
  children,
  below,
  footer,
}: {
  title: ReactNode;
  /** The desktop card's heading, when it says more than the phone's (« Bienvenue sur Mazed Immo »). */
  desktopTitle?: ReactNode;
  intro?: string;
  children: ReactNode;
  below?: ReactNode;
  footer?: ReactNode;
}) {
  const t = await getTranslations("brand");
  const locale = await getLocale();
  const arabic = locale === "ar" ? "font-arabic" : "";

  return (
    <div className="lg:grid lg:h-[100dvh] lg:grid-cols-[1.05fr_0.95fr] lg:overflow-hidden">
      {/* ── Phone (< lg): the photo, the title over it ── */}
      <section className="relative overflow-hidden bg-[#1b2a36] lg:hidden" aria-labelledby={TITLE_ID}>
        <HeroPhoto hiddenAt={LG_UP} className="absolute inset-0" />
        <div className="mazed-hero-scrim absolute inset-0" aria-hidden />
        <div className="relative px-5 pb-14 pt-[4.5rem] text-white">
          {/* The logo on the photo: its dark-surface file (the « A » and
              the gavel in cream) on a smoked-glass tile, so the gold holds
              over the white walls of the picture. */}
          <p className="inline-flex rounded-2xl bg-black/40 p-2.5 ring-1 ring-white/20 backdrop-blur-sm">
            <BrandLogo variant="logoOnDark" alt={t("name")} eager className="h-16 w-auto" />
          </p>
          <h1 id={TITLE_ID} className={`mazed-display mt-3 max-w-[14ch] text-[30px] text-white drop-shadow-sm ${arabic}`}>
            {title}
          </h1>
          {intro && <p className={`mt-2.5 max-w-sm text-[13.5px] leading-snug text-white/85 ${arabic}`}>{intro}</p>}
        </div>
      </section>

      {/* ── Desktop (lg+): the photo panel with the trust points ── */}
      <div className="hidden lg:block">
        <AuthHeroPanel />
      </div>

      {/* The card, once. On a phone it floats off the photo's lower edge; from
          lg it sits in the second column, which SCROLLS when the card is
          taller than the viewport (`my-auto`, not `items-center`: a centred
          flex item taller than its box starts above it, and that top cannot
          be scrolled to — the signup card did, on a 768 px laptop). */}
      <div className="relative z-10 -mt-8 px-4 pb-10 lg:mt-0 lg:flex lg:h-[100dvh] lg:flex-col lg:overflow-y-auto lg:bg-paper-warm lg:px-8 lg:py-10">
        <div className="mazed-float p-5 lg:mx-auto lg:my-auto lg:w-full lg:max-w-md lg:p-8">
          {/* The desktop head of the card. Lazy: hidden on a phone, the logo
              is then never fetched (an eager image in display:none still is). */}
          <div className="hidden flex-col items-center text-center lg:flex">
            <BrandLogo variant="logo" alt={t("name")} className="h-24 w-auto" />
            {/* Each width has its own heading; CSS shows one, and only that
                one is read. */}
            <h1 className={`mazed-h2 mt-5 text-[26px] text-foreground ${arabic}`}>{desktopTitle ?? title}</h1>
            {intro && <p className="mt-2 text-[13px] leading-relaxed text-muted">{intro}</p>}
          </div>

          <div className="lg:mt-7">
            {children}
            {below}
          </div>
          {footer && <div className="mt-6 hidden text-center text-[13px] text-muted lg:block">{footer}</div>}
        </div>
        {footer && <div className="mt-5 text-center text-[13px] text-muted lg:hidden">{footer}</div>}
      </div>
    </div>
  );
}
