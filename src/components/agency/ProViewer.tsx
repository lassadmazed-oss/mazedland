"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { ArrowUpRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { useSessionCookie } from "@/lib/useSessionCookie";

/**
 * Who is reading /pro, found out in the browser.
 *
 * The page is one static HTML for every visitor, served from the CDN
 * (src/app/[locale]/pro/page.tsx), so it is drawn for a guest; a visitor with
 * a session asks GET /api/pro/shops once whether they belong to an agence, and
 * the way in and the founding offer follow the answer.
 */
type Viewer = { signedIn: boolean; hasShop: boolean };

const ViewerContext = createContext<Viewer>({ signedIn: false, hasShop: false });

export function ProViewerProvider({ children }: { children: React.ReactNode }) {
  const cookie = useSessionCookie();
  const [answer, setAnswer] = useState<Viewer | null>(null);
  useEffect(() => {
    if (!cookie) return;
    let live = true;
    fetch("/api/pro/shops", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Viewer>) : null))
      .then((v) => {
        if (live && v) setAnswer({ signedIn: !!v.signedIn, hasShop: !!v.hasShop });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [cookie]);
  // Until the answer, the cookie says enough to send someone signed in to
  // the form rather than to a login that would send them home.
  const viewer = answer ?? { signedIn: cookie === true, hasShop: false };
  return <ViewerContext.Provider value={viewer}>{children}</ViewerContext.Provider>;
}

/**
 * « Ouvrir mon agence » — to the login and on to the form for a guest, to the
 * form for someone signed in, and « Mon tableau de bord » for a member of an
 * agence. Nothing while new agences are switched off in the console, except
 * for a member, who still gets to the dashboard.
 */
export function ProCta({
  signupOpen,
  label,
  dashboardLabel,
  arrow = false,
  className,
  track,
}: {
  signupOpen: boolean;
  label: string;
  dashboardLabel: string;
  arrow?: boolean;
  className: string;
  track: { cta: "hero" | "plan"; plan?: string };
}) {
  const { signedIn, hasShop } = useContext(ViewerContext);
  const locale = useLocale();
  if (!hasShop && !signupOpen) return null;
  const href = hasShop
    ? "/pro/dashboard"
    : signedIn
      ? "/pro/creer"
      : `/login?next=${encodeURIComponent(`/${locale}/pro/creer`)}`;
  return (
    <Link href={href as never} data-track="pro_cta" data-track-cta={track.cta} data-track-plan={track.plan} className={className}>
      {hasShop ? dashboardLabel : label}
      {arrow && <ArrowUpRight className="size-4 rtl:-scale-x-100" strokeWidth={2.4} aria-hidden />}
    </Link>
  );
}

/** What an agence that already runs one has no use for (the founding offer). */
export function ProNotMember({ children }: { children: React.ReactNode }) {
  const { hasShop } = useContext(ViewerContext);
  return hasShop ? null : <>{children}</>;
}
