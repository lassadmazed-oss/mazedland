"use client";

import dynamic from "next/dynamic";
import { Optional } from "@/components/ui/Optional";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { AccountMenu } from "./AccountMenu";
import { BrandLogo } from "./BrandLogo";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { InstallButton } from "./InstallButton";
import { normalizeSearchQuery } from "@/lib/search";
import { isMostlyArabic } from "@/lib/search/script";
import { useSetting } from "@/components/settings/SettingsProvider";
import { Search, Plus } from "lucide-react";
import { VoiceSearchButton } from "@/components/search/VoiceSearchButton";

// Lazy-loaded — see TopBar for rationale (heavy icon set + realtime socket +
// mount fetch, none needed for first paint). Reserves the 36px slot.
const NotificationBell = dynamic(
  () =>
    import("@/components/notifications/NotificationBell").then(
      (m) => m.NotificationBell,
    ),
  { ssr: false, loading: () => <span className="inline-block h-9 w-9" /> },
);

/**
 * Desktop (lg+) horizontal navigation. Replaces the mobile TopBar +
 * BottomTabBar on wide viewports (both are `lg:hidden`). Self-hides
 * below lg via `hidden lg:flex`, so the mobile chrome is the single
 * source of navigation on phones/tablets and stays untouched.
 *
 * Balanced three-zone bar:
 *   - Left: logo (→ home) + primary links with a soft active pill.
 *   - Center: an always-visible search that lands on the unified
 *     /properties explore surface.
 *   - Right: notification bell, account, and a saturated "Publier une annonce" CTA.
 *
 * Height is pinned to --desktop-nav-h; the shell's top padding switches
 * to the same value at lg (see .mazed-shell-main in globals.css).
 */

/**
 * "Explorer" points at /annonces, not /properties.
 *
 * /properties has 302'd to /annonces since the pivot, so the link cost every
 * desktop visitor a redirect — and, worse, `isActive` matched only the path
 * being redirected AWAY from, so the tab you had just clicked never lit up.
 * The old paths still match below: an auction-era bookmark or notification
 * should not land on an unlit nav either.
 */
/**
 * The links a property site is navigated by: what you came to do (buy, rent),
 * who sells (the agences) and the offer for them (Pro). « Accueil » is the
 * logo, « Explorer » is the search box beside these, and « Favoris » stays in
 * the account menu and on the phone's bar — the three used to take the nav's
 * whole width and said nothing a visitor does not already know.
 */
type NavLink = { key: "buy" | "rent" | "agencies" | "pro"; href: string; deal?: "sale" | "rent" };
const LINKS: NavLink[] = [
  { key: "buy", href: "/annonces?deal=sale", deal: "sale" },
  { key: "rent", href: "/annonces?deal=rent", deal: "rent" },
  { key: "agencies", href: "/agences" },
  { key: "pro", href: "/pro" },
];

/** `deal` is the catalogue's `?deal=` (QueryFromUrl): « Acheter » lights on the sales, « Louer » on the rentals. */
function isActive(pathname: string, link: NavLink, deal: string | null): boolean {
  if (link.deal) {
    // The old explore paths still redirect here; a bookmark should not land on an unlit nav.
    const catalogue = pathname === "/annonces" || pathname === "/properties" || pathname.startsWith("/auctions");
    return catalogue && deal === link.deal;
  }
  return pathname === link.href || pathname.startsWith(`${link.href}/`);
}

/**
 * Puts the address's `q` in the search box, and keeps it there.
 *
 * It used to be read once per path. Clearing a search on the catalogue (the
 * « × » on the chip, « Effacer les filtres »), a link to another search and
 * the back button all change the query and not the path, so the box went on
 * showing « Teniour » over the unfiltered list.
 *
 * A child of its own, in a Suspense with nothing as fallback: useSearchParams
 * in the bar itself would make every statically generated page (the home
 * page among them) render on the client. Here only this, which draws nothing,
 * waits for the browser.
 */
function QueryFromUrl({ onQuery }: { onQuery: (q: string, deal: string | null) => void }) {
  const sp = useSearchParams();
  const q = sp.get("q") ?? "";
  // The deal too, so « Acheter » / « Louer » light up with the catalogue.
  const deal = sp.get("deal");
  const pathname = usePathname();
  // The path too: words typed and not sent are dropped on leaving the page,
  // as before.
  useEffect(() => {
    onQuery(q, deal);
  }, [q, deal, pathname, onQuery]);
  return null;
}

export function DesktopNav() {
  const t = useTranslations("shell.tabs");
  const ts = useTranslations("search");
  const tShell = useTranslations("shell");
  const pathname = usePathname();
  const router = useRouter();
  const locale = useLocale();
  const arabicRedirect = useSetting("feature_arabic_redirect");
  const installOn = useSetting("feature_install_button");
  // What the results are filtered by; QueryFromUrl keeps it on the address.
  const [q, setQ] = useState("");
  const [deal, setDeal] = useState<string | null>(null);
  const onUrlState = useCallback((nextQ: string, nextDeal: string | null) => {
    setQ(nextQ);
    setDeal(nextDeal);
  }, []);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const clean = normalizeSearchQuery(q);
    // Keep the filters the buyer already chose. Submitting used to push `q`
    // alone, dropping category, governorate, sort and price.
    const params = new URLSearchParams(
      pathname === "/annonces" ? window.location.search : "",
    );
    params.delete("page");
    // New words are read afresh (src/lib/search/understand.ts).
    params.delete("nlq");
    params.delete("nl");
    if (clean) params.set("q", clean);
    else params.delete("q");
    const qs = params.toString();
    // Typed in Arabic on the French site: answered in Arabic, and remembered —
    // unless an admin switched that off.
    if (arabicRedirect && locale === "fr" && isMostlyArabic(clean)) {
      fetch("/api/account/language", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: "ar" }),
        keepalive: true,
      }).catch(() => {});
      router.push((qs ? `/annonces?${qs}` : "/annonces") as `/annonces`, { locale: "ar" });
      return;
    }
    router.push((qs ? `/annonces?${qs}` : "/annonces") as `/annonces`);
    return;
    // Straight to the catalogue. It reads `q` itself; going via /properties
    // only added a redirect between pressing Enter and seeing results.
    router.push(
      (clean ? `/annonces?q=${encodeURIComponent(clean)}` : "/annonces") as `/annonces`,
    );
  }

  return (
    <header className="fixed inset-x-0 top-0 z-40 hidden h-[var(--desktop-nav-h)] items-center border-b border-border bg-white lg:flex">
      {/* Tighter at lg (1024–1279px), where four links, the search and the
          button share 960px; the search keeps a floor so it never collapses. */}
      <div className="mx-auto flex h-full w-full max-w-[var(--max-w-wide)] items-center gap-4 px-6 xl:gap-6 xl:px-8">
        {/* ── Left zone: brand + primary links ── */}
        <div className="flex h-full shrink-0 items-center gap-6">
          {/* The logo sideways, matching the mobile TopBar: the portrait
              logo's MAZED is illegible at nav height — see BrandLogo. */}
          <Link href="/" className="flex shrink-0 items-center" aria-label="Mazed Immo">
            <BrandLogo variant="lockup" alt="" eager className="h-12 w-auto" />
          </Link>

          {/* The page you are on is underlined, the way a newspaper's section
              is: an ink rule under the word, not a tinted pill around it. */}
          <nav className="flex h-full items-stretch gap-0.5" aria-label={tShell("mainNav")}>
            {LINKS.map((l) => {
              const active = isActive(pathname, l, deal);
              return (
                <Link
                  key={l.key}
                  href={l.href as never}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex items-center whitespace-nowrap border-b-2 px-2.5 pt-0.5 text-[13.5px] font-semibold transition-colors xl:px-3 ${
                    active
                      ? "border-foreground text-foreground"
                      : "border-transparent text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {t(l.key)}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* ── Center zone: real search — submits to the explore surface ── */}
        <Suspense fallback={null}>
          <QueryFromUrl onQuery={onUrlState} />
        </Suspense>
        <form onSubmit={submitSearch} className="flex flex-1 justify-center" role="search">
          <div className="relative flex w-full min-w-[180px] max-w-md items-center">
            <Search
              className="pointer-events-none absolute size-4 text-muted ltr:left-4 rtl:right-4"
              strokeWidth={2}
            />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={ts("placeholder")}
              aria-label={ts("placeholder")}
              className="h-11 w-full rounded-full border border-border bg-surface-2 text-[13px] text-foreground placeholder:text-muted transition-colors focus:border-gold-soft/70 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-gold-faint px-11"
            />
            <VoiceSearchButton className="absolute end-1 top-1/2 -translate-y-1/2" />
          </div>
        </form>

        {/* ── Right zone: notifications, account, sell CTA ── */}
        <div className="flex shrink-0 items-center gap-2">
          {installOn && <InstallButton scope="site" variant="icon" />}
          <Optional name="bell" fallback={<span className="inline-block h-9 w-9" />}>
            <NotificationBell />
          </Optional>
          <LocaleSwitcher />
          <AccountMenu />
          <Link
            href="/annonces/nouvelle"
            className="mazed-gold-fill inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-[13px] font-bold shadow-[var(--shadow-gold)] transition active:scale-[0.98]"
          >
            <Plus className="size-4" strokeWidth={2.5} />
            {/* « Publier une annonce » / « انشر إعلانك » — not « Vendre »: the
                button also publishes a rental, and the owner asked for it
                (2026-10-31). Below xl the bar has no room for the whole
                phrase, and the phone's own « Publier » stands in. */}
            <span className="hidden xl:inline">{t("publishCta")}</span>
            <span className="xl:hidden">{t("sell")}</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
