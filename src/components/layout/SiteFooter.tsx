import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { BrandLogo } from "./BrandLogo";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { getSettings } from "@/lib/settings/server";

/**
 * The site's footer, on every public page.
 *
 * There was none: the home page ended on one line of legal links and every
 * other page simply stopped. A footer is where a visitor who has scrolled to
 * the end looks for the way on (the other side of the catalogue, the
 * agences, the Pro offer) and where a search engine reads what the site is.
 *
 * A server component: nothing here changes in the browser except the
 * language switch, which is its own client island. The layout hands it to
 * MobileShell, which leaves it out of the flow routes (auth, payment, the
 * console).
 */
/** TikTok icon — not in lucide-react. */
function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M16.6 5.82s.51.5 0 0A4.278 4.278 0 0 1 15.54 3h-3.09v12.4a2.592 2.592 0 0 1-2.59 2.5c-1.42 0-2.6-1.16-2.6-2.6 0-1.72 1.66-3.01 3.37-2.48V9.66c-3.45-.46-6.47 2.22-6.47 5.64 0 3.33 2.76 5.7 5.69 5.7 3.14 0 5.69-2.55 5.69-5.7V9.01a7.35 7.35 0 0 0 4.3 1.38V7.3s-1.88.09-3.24-1.48z" />
    </svg>
  );
}

export async function SiteFooter() {
  const t = await getTranslations();
  const s = await getSettings();
  const year = String(new Date().getFullYear());
  const tiktok = s.contact_tiktok;

  const columns: { key: string; title: string; links: { href: string; label: string }[] }[] = [
    {
      key: "explore",
      title: t("footer.explore"),
      links: [
        { href: "/annonces?deal=sale", label: t("footer.buy") },
        { href: "/annonces?deal=rent", label: t("footer.rent") },
        { href: "/agences", label: t("footer.agencies") },
        { href: "/annonces/nouvelle", label: t("footer.publish") },
      ],
    },
    {
      key: "company",
      title: t("footer.company"),
      links: [
        { href: "/pro", label: t("footer.pro") },
        { href: "/contact", label: t("landing.footerLinks.contact") },
      ],
    },
    {
      key: "info",
      title: t("footer.info"),
      links: [
        { href: "/terms", label: t("landing.footerLinks.terms") },
        { href: "/privacy", label: t("landing.footerLinks.privacy") },
      ],
    },
  ];

  return (
    <footer className="mazed-band-warm mt-16 border-t border-border lg:mt-24">
      <div className="mx-auto max-w-[var(--max-w-wide)] px-5 py-10 md:px-8 lg:py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div className="sm:col-span-2 lg:col-span-1">
            {/* The whole logo: the footer has the room the bars do not. */}
            <Link href="/" className="inline-flex" aria-label={t("brand.name")}>
              <BrandLogo variant="logo" alt="" className="h-28 w-auto" />
            </Link>
            <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-muted">{t("brand.tagline")}</p>
            <p className="mt-2 text-[13px] font-bold text-foreground">{t("brand.slogan")}</p>
          </div>

          {columns.map((c) => (
            <nav key={c.key} aria-labelledby={`footer-${c.key}`}>
              <p id={`footer-${c.key}`} className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-subtle">
                {c.title}
              </p>
              <ul className="mt-3 space-y-2.5">
                {c.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href as never}
                      className="text-[13.5px] font-semibold text-foreground/80 transition-colors hover:text-foreground"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-4 border-t border-border pt-6 text-[12px] text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>
            {t("footer.rights", { year, name: t("brand.name") })} · {t("footer.country")}
          </p>
          <div className="flex items-center gap-3">
            {tiktok && (
              <a
                href={`https://www.tiktok.com/@${tiktok}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="TikTok"
                className="inline-flex size-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                <TikTokIcon className="size-4" />
              </a>
            )}
            <span>{t("footer.language")}</span>
            <LocaleSwitcher />
          </div>
        </div>
      </div>
    </footer>
  );
}
