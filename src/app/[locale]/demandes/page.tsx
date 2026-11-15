import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowUpRight, BellRing, Building2, MapPin, Search } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings/server";
import { categoryLabel } from "@/lib/i18n";
import { governorateLabel } from "@/lib/tunisia";
import { formatDate, formatNumber, formatTND } from "@/lib/utils";
import { jsonLdSafe } from "@/lib/jsonld";
import { breadcrumbLd, pageAlternates } from "@/lib/seo";
import { PRODUCTION_ORIGIN, siteUrl } from "@/lib/siteUrl";
import { boardCards, boardShown, boardTotals, type BoardCard } from "@/lib/requests/board";
import { loadOpenDemandes } from "@/lib/requests/boardServer";

// The same page for everyone, from the CDN: a new demande shows within the
// quarter hour; switching the page off in the console takes effect at once
// (saving the settings revalidates the site).
export const revalidate = 900;
// A build that fails, naming the API, the day something here reads the request
// (src/app/[locale]/(home)/page.tsx says why).
export const dynamic = "error";

async function boardOn() {
  const s = await getSettings();
  return s.feature_requests && s.requests_board;
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!(await boardOn())) return { robots: { index: false, follow: false } };
  const t = await getTranslations({ locale, namespace: "demandesBoard" });
  const title = t("metaTitle");
  const description = t("metaDescription");
  return {
    title,
    description,
    alternates: pageAlternates(locale, "/demandes"),
    openGraph: { type: "website", siteName: "Mazed Immo", title, description, url: `/${locale}/demandes`, images: [{ url: "/og.png", width: 1200, height: 630, alt: title }] },
  };
}

/**
 * « Ce que les gens cherchent » (the owner, 2026-11-15): what buyers and
 * tenants asked for, so the next one sees he is heard and an agency that is
 * not on Mazed yet sees what the market wants — and joins to offer it.
 * Totals for every open demande; a card only for those saved under the text
 * that says so (`requests_board_cards_since`). Rules: src/lib/requests/board.ts.
 */
export default async function DemandesBoardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const settings = await getSettings();
  if (!settings.feature_requests || !settings.requests_board) notFound();
  const t = await getTranslations("demandesBoard");
  const tReq = await getTranslations("requests");
  const tc = await getTranslations("common");

  const rows = await loadOpenDemandes();
  const totals = boardTotals(rows);
  const shown = boardShown(totals.total, settings.requests_board_min);
  const cards = shown ? boardCards(rows, settings.requests_board_cards_since) : [];

  // Category names, for the kinds and the cards.
  const admin = getServiceSupabase();
  const { data: catRows } = admin ? await admin.from("categories").select("id, label_fr, label_ar") : { data: [] };
  const cats = new Map(((catRows ?? []) as { id: string; label_fr: string; label_ar: string | null }[]).map((c) => [c.id, c]));
  const catName = (id: string | null) => (id && cats.get(id) ? categoryLabel(cats.get(id), locale) : tReq("anyCategory"));
  const placeName = (g: string | null) => (g ? governorateLabel(g, locale) : tReq("anywhere"));
  const money = (v: number) => `${formatTND(v, locale)} ${tc("tnd")}`;

  const origin = siteUrl() ?? PRODUCTION_ORIGIN;
  const ld = breadcrumbLd([
    { name: "Mazed Immo", url: `${origin}/${locale}` },
    { name: t("title"), url: `${origin}/${locale}/demandes` },
  ]);
  const top = Math.max(1, ...totals.byGovernorate.map((g) => g.count));
  const buyerHref = "/demandes/nouvelle?via=board";

  const cardLine = (c: BoardCard) =>
    [
      c.budgetMax != null ? tReq(c.deal === "rent" ? "upToPerMonth" : "upTo", { amount: money(c.budgetMax) }) : null,
      c.budgetMin != null ? tReq("fromAmount", { amount: money(c.budgetMin) }) : null,
      c.surfaceMin != null ? tReq("surfaceAtLeast", { area: formatNumber(c.surfaceMin, locale) }) : null,
      c.roomsMin != null ? tReq("roomsAtLeast", { count: c.roomsMin }) : null,
      c.furnished ? tReq(`furnished.${c.furnished}`) : null,
    ].filter(Boolean).join(" · ");

  const steps = [
    { key: "step1", Icon: Search },
    { key: "step2", Icon: BellRing },
    { key: "step3", Icon: Building2 },
  ] as const;

  return (
    <main className="mx-auto max-w-[var(--max-w-wide)] px-4 py-6 lg:px-8 lg:py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdSafe(ld) }} />

      <header className="max-w-3xl">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-subtle">{t("eyebrow")}</p>
        <h1 className="mazed-display mt-1.5 text-[34px] text-foreground lg:text-[52px]">{t("title")}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted lg:text-[16px]">{shown ? t("lead", { count: totals.total }) : t("quiet")}</p>
        <div className="mt-5 flex flex-wrap gap-2.5">
          <Link
            href={buyerHref as never}
            data-track="demande_cta"
            data-track-via="board"
            className="mazed-btn-luxe tap-target inline-flex h-11 items-center gap-2 rounded-full px-5 text-[14px]"
          >
            <BellRing className="size-4" aria-hidden /> {t("ctaBuyer")}
          </Link>
          {shown && (
            <Link href={"/pro" as never} className="mazed-btn-quiet tap-target inline-flex h-11 items-center gap-2 rounded-full px-5 text-[14px]">
              <Building2 className="size-4" aria-hidden /> {t("ctaAgency")}
            </Link>
          )}
        </div>
      </header>

      {shown && (
        <>
          {/* ── Totals: a count names nobody, so every open demande is in them. */}
          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            <section className="rounded-[var(--radius-2xl)] bg-surface p-5 ring-1 ring-border" aria-labelledby="board-where">
              <h2 id="board-where" className="mazed-h2 text-[19px] text-foreground">{t("whereTitle")}</h2>
              <p className="mazed-tabular mt-1 text-[12.5px] text-muted">{t("split", { sale: totals.sale, rent: totals.rent })}</p>
              <ul className="mt-4 space-y-2.5">
                {totals.byGovernorate.slice(0, 12).map((g) => (
                  <li key={g.governorate ?? "any"}>
                    <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
                      <span className="inline-flex items-center gap-1.5 font-bold text-foreground">
                        <MapPin className="size-3.5 text-muted" aria-hidden /> {placeName(g.governorate)}
                      </span>
                      <span className="mazed-tabular text-muted">{t("count", { count: g.count })}</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2">
                      <div className="h-full rounded-full bg-foreground" style={{ width: `${Math.max(6, Math.round((g.count / top) * 100))}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-[var(--radius-2xl)] bg-surface p-5 ring-1 ring-border" aria-labelledby="board-what">
              <h2 id="board-what" className="mazed-h2 text-[19px] text-foreground">{t("whatTitle")}</h2>
              <ul className="mt-4 divide-y divide-border">
                {totals.byKind.slice(0, 12).map((k) => (
                  <li key={`${k.deal}:${k.categoryId ?? ""}`} className="flex items-baseline justify-between gap-3 py-2.5 text-[13.5px]">
                    <span className="font-bold text-foreground">
                      {catName(k.categoryId)} <span className="font-semibold text-muted">· {t(k.deal)}</span>
                    </span>
                    <span className="mazed-tabular shrink-0 text-muted">{t("count", { count: k.count })}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {/* ── Cards: only the demandes saved under the text that says so. */}
          <section className="mt-10" aria-labelledby="board-cards">
            <h2 id="board-cards" className="mazed-h2 text-[21px] text-foreground lg:text-[24px]">{t("cardsTitle")}</h2>
            {cards.length > 0 ? (
              <>
                <p className="mt-1 text-[12.5px] text-muted">{t("cardsHint")}</p>
                <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {cards.map((c) => (
                    <li key={c.id} className="rounded-[var(--radius-2xl)] bg-surface p-4 ring-1 ring-border">
                      <div className="flex items-start justify-between gap-2">
                        <p className="mazed-eyebrow">{tReq(c.deal === "rent" ? "kindRent" : "kindBuy")}</p>
                        <span className="shrink-0 text-[11px] text-subtle">{formatDate(c.createdAt, locale, "dayMonth")}</span>
                      </div>
                      <p className="mt-1 text-[14.5px] font-bold leading-snug text-foreground">
                        {(c.categoryIds.length ? c.categoryIds.map((id) => catName(id)) : [tReq("anyCategory")]).join(", ")}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1 text-[12.5px] text-muted">
                        <MapPin className="size-3.5 shrink-0" aria-hidden />
                        {(c.governorates.length ? c.governorates.map((g) => placeName(g)) : [tReq("anywhere")]).join(", ")}
                      </p>
                      {cardLine(c) && <p className="mazed-tabular mt-2 text-[12.5px] text-foreground">{cardLine(c)}</p>}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="mt-2 rounded-2xl bg-surface-2 p-4 text-[13px] text-muted ring-1 ring-border">{t("cardsLater")}</p>
            )}
          </section>

          {/* ── For the agencies: what they came to see, and the way to answer it. */}
          <section className="mazed-band-ink mt-10 rounded-[var(--radius-3xl)] px-6 py-8 lg:px-10 lg:py-10" aria-labelledby="board-agencies">
            <h2 id="board-agencies" className="mazed-h2 text-[22px] text-[var(--background)] lg:text-[28px]">{t("agencyTitle")}</h2>
            <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-white/75">{t("agencyBody")}</p>
            <Link
              href={"/pro" as never}
              className="tap-target mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-[var(--background)] px-5 text-[14px] font-extrabold text-foreground transition hover:bg-surface-2"
            >
              {t("agencyCta")} <ArrowUpRight className="size-4 rtl:-scale-x-100" aria-hidden />
            </Link>
          </section>
        </>
      )}

      {/* ── How it works, for the visitor who came to ask. */}
      <section className="mazed-band-warm mt-10 rounded-[var(--radius-3xl)] p-6 lg:p-10" aria-labelledby="board-how">
        <h2 id="board-how" className="mazed-h2 text-[21px] text-foreground lg:text-[24px]">{t("howTitle")}</h2>
        <ol className="mt-5 grid gap-3 lg:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.key} className="flex items-start gap-3 rounded-2xl bg-surface p-4 ring-1 ring-border">
              <span className="mazed-tabular inline-grid size-9 shrink-0 place-items-center rounded-full bg-foreground text-[13px] font-extrabold text-[var(--background)]">{i + 1}</span>
              <span className="text-[13.5px] leading-relaxed text-foreground">
                <s.Icon className="me-1 inline size-4 align-[-2px] text-muted" aria-hidden />
                {t(s.key)}
              </span>
            </li>
          ))}
        </ol>
        <Link
          href={buyerHref as never}
          data-track="demande_cta"
          data-track-via="board"
          className="mazed-btn-luxe tap-target mt-6 inline-flex h-11 items-center gap-2 rounded-full px-5 text-[14px]"
        >
          <BellRing className="size-4" aria-hidden /> {t("ctaBuyer")}
        </Link>
      </section>
    </main>
  );
}
