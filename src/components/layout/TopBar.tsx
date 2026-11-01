"use client";

import dynamic from "next/dynamic";
import { Optional } from "@/components/ui/Optional";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, Link } from "@/i18n/navigation";
import { BackButton } from "./BackButton";
import { BrandLogo } from "./BrandLogo";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { InstallButton } from "./InstallButton";
import { useSetting } from "@/components/settings/SettingsProvider";

// Lazy-loaded: the bell pulls in ~40 lucide icons, opens a realtime socket,
// and fetches /api/notifications on mount — none of which is needed for first
// paint. Deferring it (ssr:false) keeps it out of the initial bundle so every
// page becomes interactive sooner. The placeholder reserves the 36px slot so
// the bar doesn't shift when the bell hydrates in.
const NotificationBell = dynamic(
  () =>
    import("@/components/notifications/NotificationBell").then(
      (m) => m.NotificationBell,
    ),
  { ssr: false, loading: () => <span className="inline-block h-9 w-9" /> },
);

/**
 * Where the bottom tab bar can put you. On these the bar shows the brand; on
 * anything else it shows a back button and the page title.
 *
 * `/properties` was listed here and `/annonces` was not — but `/properties`
 * has 302'd to `/annonces` since the pivot, so the set described a page
 * nobody lands on and omitted the one the "Explorer" tab actually opens. The
 * result was a root tab that greeted you with a bare back arrow and no title.
 */
const ROOT_TAB_PATHS = new Set(["/", "/annonces", "/account/activity", "/account"]);

// Map the first path segment to the i18n key under shell.pageTitles.
// Anything not in here falls back to the brand mark.
const TITLE_BY_SEGMENT: Record<string, string> = {
  // Inner annonce pages. The list itself is a root tab (above) and never
  // reaches this map; /annonces/nouvelle is special-cased below, because the
  // map keys off the FIRST segment and "Annonce" is the wrong heading for the
  // publish wizard.
  annonces: "annonces",
  properties: "properties",
  auctions: "auctions",
  inspectors: "inspectors",
  watchlist: "watchlist",
  account: "account",
  login: "login",
  signup: "signup",
  kyc: "kyc",
  partners: "partners",
  sell: "sell",
  admin: "admin",
  payment: "payment",
  agences: "agences",
  pro: "pro",
};

/**
 * Mobile-app top bar — ported from the mazed-auto pattern.
 *
 *   - Plain white with a hairline border, no glass and no gold rule. The
 *     chrome stays out of the way so the page content carries the design
 *     weight.
 *   - Root pages get the logo (the tower and MAZED, side by side).
 *   - Inner pages get a back button, the tower, and the page title.
 */
export function TopBar() {
  const t = useTranslations();
  const installOn = useSetting("feature_install_button");
  const locale = useLocale();
  const isRTL = locale === "ar";
  const pathname = usePathname();

  const isRoot = ROOT_TAB_PATHS.has(pathname) || pathname === "/";
  const segment = pathname.split("/").filter(Boolean)[0];
  const titleKey =
    pathname === "/annonces/nouvelle"
      ? "annoncesNew"
      : segment
        ? TITLE_BY_SEGMENT[segment]
        : undefined;

  return (
    <header
      className="fixed inset-x-0 top-0 z-40 bg-white border-b border-border pt-safe lg:hidden"
      style={{ height: "calc(var(--mazed-topbar-h) + var(--mazed-safe-top))" }}
    >
      <div className="mx-auto flex h-[var(--mazed-topbar-h)] max-w-[var(--max-w-wide)] items-center gap-2 px-4">
        {/* LEADING — back on inner pages, brand on root.
            BackButton lives in its own component so the parent-path
            mapping (which avoids redirect loops on routes like
            /auctions/[id]/bid) is shared with any other surface that
            needs an in-app back affordance. */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {isRoot ? (
            <BrandMark />
          ) : (
            <>
              <BackButton />
              {/* The tower on inner pages too — the logo is on every page —
                  and a way home in one tap. */}
              <Link href="/" className="shrink-0" aria-label={t("brand.name")}>
                <BrandLogo variant="mark" alt="" eager className="h-8 w-auto" />
              </Link>
              {/* A <p>, not an <h1>: every page below has its own heading, and
                  a listing page ended up with two — "Annonce" in the bar and
                  the annonce's title in the page. */}
              {titleKey && (
                <p
                  className={`truncate text-[16px] font-bold tracking-tight text-foreground ${
                    isRTL ? "font-arabic" : ""
                  }`}
                >
                  {t(`shell.pageTitles.${titleKey}`)}
                </p>
              )}
            </>
          )}
        </div>

        {/* TRAILING — install the app, notifications bell, locale switcher */}
        <div className="flex items-center gap-1">
          {installOn && <InstallButton scope="site" variant="icon" />}
          <Optional name="bell" fallback={<span className="inline-block h-9 w-9" />}>
            <NotificationBell />
          </Optional>
          <LocaleSwitcher />
        </div>
      </div>
    </header>
  );
}

function BrandMark() {
  const t = useTranslations("brand");
  // The owner's logo, laid out sideways: the tower, then MAZED between its
  // gold rules (see BrandLogo). It was the tower beside « Mazed Immo » in
  // plain type; the owner asked for the logo itself.
  //
  // Eager, not preloaded: the bar is above the fold on every page that shows
  // it, and an <img> near the top of the HTML is all the head start a small
  // file needs.
  return (
    <Link href="/" className="flex min-w-0 items-center" aria-label={t("name")}>
      <BrandLogo variant="lockup" alt="" eager className="h-10 w-auto shrink-0" />
    </Link>
  );
}
