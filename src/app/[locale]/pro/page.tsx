import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { WhatsAppHelp } from "@/components/ui/WhatsAppHelp";
import { HeroPhoto } from "@/components/landing/HeroPhoto";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { formatTND } from "@/lib/utils";
import { membershipsOf } from "@/lib/pro/shops";
import { getSettings } from "@/lib/settings/server";
import { BadgeCheck, Check, LayoutGrid, Store, Users, Sparkles, ArrowUpRight } from "lucide-react";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pro.landing");
  const locale = await getLocale();
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: {
      canonical: `/${locale}/pro`,
      languages: { fr: "/fr/pro", ar: "/ar/pro", "x-default": "/fr/pro" },
    },
  };
}

type Plan = { slug: string; name_fr: string; name_ar: string | null; description: string | null; description_ar: string | null; price: number | string; listing_quota: number };

/**
 * Mazed Immo Pro (cahier global V1 §03): what a shop gives a professional,
 * the three plans with their price and room, and the way in — open a shop
 * with the account you already have, or go to the one you run.
 *
 * THE LOOK (2026-10-31 redesign): a hero that shows the product — a mock of
 * the agence page an agence gets — beside the promise; the four benefits as
 * quiet tiles; the three plans as pricing cards with the middle one raised.
 */
export default async function ProLandingPage() {
  const locale = await getLocale();
  const t = await getTranslations("pro.landing");
  const tShops = await getTranslations("shops");
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const admin = getServiceSupabase();

  const [{ data: planRows }, memberships, settings] = await Promise.all([
    (admin ?? supabase)
      .from("products")
      .select("slug, name_fr, name_ar, description, description_ar, price, listing_quota")
      .eq("kind", "subscription")
      .eq("is_active", true)
      .order("price"),
    user && admin ? membershipsOf(admin, user.id) : Promise.resolve([]),
    getSettings(),
  ]);
  const plans = (planRows ?? []) as Plan[];
  const hasShop = memberships.length > 0;
  const cta = hasShop ? "/pro/dashboard" : user ? "/pro/creer" : `/login?next=${encodeURIComponent(`/${locale}/pro/creer`)}`;
  // New shops switched off in the console: no « Ouvrir ma boutique ». The plans
  // stay on show, and whoever runs a shop still gets to its dashboard.
  const showCta = hasShop || settings.feature_pro_signup;

  // « Les demandes » is only a benefit while demandes are on in the console.
  const benefits = ([
    { Icon: Store, key: "shop" },
    { Icon: LayoutGrid, key: "marketplace" },
    { Icon: Users, key: "team" },
    { Icon: Sparkles, key: "matches" },
  ] as const).filter((b) => b.key !== "matches" || settings.feature_requests);

  const ctaLabel = t(hasShop ? "ctaDashboard" : "ctaCreate");

  return (
    <main className="mx-auto max-w-[var(--max-w-wide)] px-4 pb-10 pt-4 lg:px-8 lg:pt-8">
      {/* ── Hero: the promise, and the page an agence gets ── */}
      <section className="mazed-band-warm overflow-hidden rounded-[var(--radius-3xl)] px-6 py-10 lg:px-16 lg:py-16">
        <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <p className="text-[12px] font-extrabold uppercase tracking-[0.16em] text-muted">Mazed Immo Pro</p>
            <h1 className="mazed-display mt-3 max-w-[16ch] text-[32px] text-foreground lg:text-[52px]">{t("title")}</h1>
            <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-muted lg:text-[17px]">{t("subtitle")}</p>
            <div className="mt-7 flex flex-wrap items-center gap-4">
              {showCta && (
                <Link href={cta as never} className="mazed-btn-luxe tap-target inline-flex h-12 items-center gap-2 px-7 text-[14px]">
                  {ctaLabel} <ArrowUpRight className="size-4 rtl:-scale-x-100" strokeWidth={2.4} aria-hidden />
                </Link>
              )}
              <WhatsAppHelp topic="pro" />
            </div>
          </div>

          {/* A mock of an agence page, drawn with the site's own parts. */}
          <div aria-hidden className="mazed-float overflow-hidden p-0">
            <div className="relative h-28 overflow-hidden bg-[#1b2a36] lg:h-36">
              <HeroPhoto hiddenAt="not all" className="absolute inset-0" />
            </div>
            <div className="relative z-10 px-5 pb-5">
              <div className="flex items-end gap-3">
                <span className="-mt-7 grid size-14 place-items-center rounded-2xl bg-surface text-[18px] font-extrabold text-foreground shadow-[var(--shadow-card)] ring-4 ring-[var(--background)]">
                  <Store className="size-6" strokeWidth={2} />
                </span>
                <div className="pt-2">
                  <div className="flex items-center gap-1.5 text-[15px] font-extrabold text-foreground">
                    {t("benefits.shop.title")}
                    <span className="inline-flex items-center gap-1 rounded-full bg-foreground px-2 py-0.5 text-[10px] font-bold text-[var(--background)]">
                      <BadgeCheck className="size-3" strokeWidth={2.4} /> {tShops("verified")}
                    </span>
                  </div>
                  <div className="text-[12px] text-muted">{tShops("listingsCount", { count: 24 })}</div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {[0, 1, 2].map((i) => (
                  <div key={i}>
                    <div className="aspect-[4/3] rounded-xl bg-surface-3/70" />
                    <div className="mt-2 h-2.5 w-3/4 rounded-full bg-surface-3" />
                    <div className="mt-1.5 h-2 w-1/2 rounded-full bg-surface-2" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── What it gives ── */}
      <section className="mazed-section grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
        {benefits.map(({ Icon, key }) => (
          <div key={key} className="rounded-2xl border border-border bg-surface p-5">
            <span className="inline-grid size-10 place-items-center rounded-full bg-foreground text-[var(--background)]">
              <Icon className="size-[18px]" strokeWidth={2.2} aria-hidden />
            </span>
            <p className="mt-4 text-[15px] font-extrabold text-foreground">{t(`benefits.${key}.title`)}</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{t(`benefits.${key}.body`)}</p>
          </div>
        ))}
      </section>

      {/* ── The plans ── */}
      <section className="mazed-section">
        <h2 className="mazed-h2 text-center text-[24px] text-foreground lg:text-[32px]">{t("plansTitle")}</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3 md:items-stretch">
          {plans.map((p, i) => {
            const featured = i === 1;
            return (
              <div
                key={p.slug}
                className={`relative flex flex-col rounded-[var(--radius-3xl)] bg-surface p-6 ${
                  featured
                    ? "ring-2 ring-foreground shadow-[var(--shadow-float)] md:-my-3 md:py-9"
                    : "ring-1 ring-border"
                }`}
              >
                {featured && (
                  <span className="absolute -top-3 start-6 rounded-full bg-foreground px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.12em] text-[var(--background)]">
                    {t("popular")}
                  </span>
                )}
                <p className="text-[15px] font-extrabold text-foreground">{locale === "ar" && p.name_ar ? p.name_ar : p.name_fr}</p>
                <p className="mt-3 flex items-baseline gap-1.5">
                  <span className="mazed-tabular text-[38px] font-extrabold leading-none text-foreground">{formatTND(Number(p.price), locale)}</span>
                  <span className="text-[13px] font-semibold text-muted">{t("perMonth")}</span>
                </p>
                <p className="mt-2 text-[13px] font-bold text-foreground">{t("quota", { count: p.listing_quota })}</p>
                <p className="mt-3 flex-1 text-[13px] leading-relaxed text-muted" dir="auto">
                  {locale === "ar" && p.description_ar ? p.description_ar : p.description}
                </p>
                <ul className="mt-5 space-y-2 border-t border-border pt-5 text-[13px] text-foreground">
                  {(["shopPage", "inCatalogue", "noCommission"] as const).map((k) => (
                    <li key={k} className="flex items-start gap-2.5">
                      <span className="mt-0.5 inline-grid size-4 shrink-0 place-items-center rounded-full bg-foreground text-[var(--background)]">
                        <Check className="size-2.5" strokeWidth={3} aria-hidden />
                      </span>
                      {t(`included.${k}`)}
                    </li>
                  ))}
                </ul>
                {showCta && (
                  <Link
                    href={cta as never}
                    className={`tap-target mt-6 inline-flex h-11 items-center justify-center rounded-full text-[13.5px] font-bold transition ${
                      featured
                        ? "mazed-btn-luxe"
                        : "bg-surface text-foreground ring-1 ring-border hover:ring-foreground/40"
                    }`}
                  >
                    {hasShop ? ctaLabel : t("planCta")}
                  </Link>
                )}
              </div>
            );
          })}
        </div>
        <p className="mx-auto mt-8 flex max-w-2xl items-start justify-center gap-2 text-center text-[12.5px] leading-relaxed text-muted">
          <BadgeCheck className="mt-0.5 size-4 shrink-0" aria-hidden /> {t("verifiedNote")}
        </p>
        <div className="mt-4 flex justify-center">
          <WhatsAppHelp topic="pro" />
        </div>
      </section>
    </main>
  );
}
