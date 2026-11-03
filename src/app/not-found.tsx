import type { Metadata } from "next";
import Link from "next/link";
import { BrandLogo } from "@/components/layout/BrandLogo";
import { jakarta, cairo } from "./fonts";

/**
 * The page for a URL no route matches.
 *
 * Next's built-in one said "404 · This page could not be found." — in English,
 * unbranded, with no way back. An unmatched URL is resolved before anything
 * streams, so this keeps a real 404 status. (A `notFound()` from inside a page
 * cannot: `[locale]/loading.tsx` has already sent the shell with a 200, and Next
 * marks that page noindex instead — see `[locale]/not-found.tsx`. A catch-all
 * page under [locale] that called notFound() made every unknown URL a soft
 * 404 for the same reason; the QA tour of 2026-10-30 found it, and it is gone.)
 *
 * It sits outside [locale], so it renders its own <html>. /ar/… gets the
 * Arabic page, right to left, with the French below; /fr/… and everything
 * else, the reverse. The address is read in the browser, by the one-line
 * script in <head>, before anything paints — never from the request: Next
 * renders this page inside the home page too (it is that route's not-found
 * boundary), and the `headers()` it used to read made the home page render on
 * every visit instead of coming from the CDN (speed tour, 2026-11-03). The
 * home page's `dynamic = "error"` now fails the build if that comes back.
 */

// One page for every address, so one title for both languages.
export const metadata: Metadata = {
  // Absolute: the layout's template (« %s · Mazed Immo ») would name the brand twice.
  title: { absolute: "Page introuvable · الصفحة غير موجودة — Mazed Immo" },
};

/** Before the first paint: an /ar/… address turns the page Arabic-first. */
const ARABIC_FIRST =
  'if(location.pathname.split("/")[1]==="ar"){var d=document.documentElement;d.lang="ar";d.dir="rtl";d.setAttribute("data-nf","ar")}';
/** Each order is in the page; the script's mark picks one. */
const ORDER_CSS = 'html[data-nf="ar"] .nf-fr-first,html:not([data-nf="ar"]) .nf-ar-first{display:none}';

function French({ secondary }: { secondary: boolean }) {
  return (
    <div lang="fr" dir="ltr" className={secondary ? "mt-10 w-full border-t border-border pt-8" : undefined}>
      {secondary ? (
        <h2 className="text-[19px] font-extrabold leading-tight text-foreground">Page introuvable</h2>
      ) : (
        <h1 className="mt-6 text-[22px] font-extrabold leading-tight tracking-tight text-foreground">Page introuvable</h1>
      )}
      <p className="mt-2 text-[13px] leading-relaxed text-[var(--foreground-muted)]">
        Le lien que vous avez suivi n&apos;existe pas ou a été déplacé.
      </p>
      <div className={`${secondary ? "mt-5" : "mt-7"} flex flex-wrap items-center justify-center gap-2.5`}>
        <Link
          href="/fr/annonces"
          className="tap-target inline-flex h-11 items-center justify-center rounded-full bg-foreground px-6 text-[13px] font-bold text-[var(--background)] transition active:scale-[0.98]"
        >
          Voir les annonces
        </Link>
        <Link
          href="/fr"
          className="tap-target inline-flex h-11 items-center justify-center rounded-full border border-border px-6 text-[13px] font-bold text-foreground transition hover:bg-surface-2 active:scale-[0.98]"
        >
          Accueil
        </Link>
      </div>
    </div>
  );
}

function Arabic({ secondary }: { secondary: boolean }) {
  return (
    <div
      lang="ar"
      dir="rtl"
      className={secondary ? "mt-10 w-full border-t border-border pt-8" : undefined}
      style={{ fontFamily: "var(--font-arabic)" }}
    >
      {secondary ? (
        <h2 className="text-[19px] font-extrabold leading-tight text-foreground">الصفحة هذي ما لقيناهاش</h2>
      ) : (
        <h1 className="mt-6 text-[22px] font-extrabold leading-tight tracking-tight text-foreground">الصفحة هذي ما لقيناهاش</h1>
      )}
      <p className="mt-2 text-[13px] leading-relaxed text-[var(--foreground-muted)]">
        الرابط اللي تبعتو غير موجود ولا تبدّل.
      </p>
      <div className={`${secondary ? "mt-5" : "mt-7"} flex flex-wrap items-center justify-center gap-2.5`}>
        <Link
          href="/ar/annonces"
          className="tap-target inline-flex h-11 items-center justify-center rounded-full bg-foreground px-6 text-[13px] font-bold text-[var(--background)] transition active:scale-[0.98]"
        >
          شوف الإعلانات
        </Link>
        <Link
          href="/ar"
          className="tap-target inline-flex h-11 items-center justify-center rounded-full border border-border px-6 text-[13px] font-bold text-foreground transition hover:bg-surface-2 active:scale-[0.98]"
        >
          الصفحة الرئيسية
        </Link>
      </div>
    </div>
  );
}

export default function RootNotFound() {
  return (
    // The script changes lang/dir before React hydrates: that difference is expected.
    <html lang="fr" dir="ltr" suppressHydrationWarning className={`${jakarta.variable} ${cairo.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: ARABIC_FIRST }} />
        <style dangerouslySetInnerHTML={{ __html: ORDER_CSS }} />
      </head>
      <body className="min-h-full bg-background text-foreground font-sans" style={{ background: "#ffffff" }}>
        <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col items-center justify-center px-6 text-center">
          <BrandLogo variant="logo" eager className="h-28 w-auto" />
          <div className="nf-fr-first w-full">
            <French secondary={false} />
            <Arabic secondary />
          </div>
          <div className="nf-ar-first w-full">
            <Arabic secondary={false} />
            <French secondary />
          </div>
        </main>
      </body>
    </html>
  );
}
