"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { normalizeSearchQuery } from "@/lib/search";
import { isMostlyArabic } from "@/lib/search/script";
import { TUNISIAN_GOVERNORATES, governorateLabel } from "@/lib/tunisia";
import { delegationLabel, delegationsOf } from "@/lib/delegations";
import { Search, MapPin, Home } from "lucide-react";
import { SelectMenu, type SelectOption } from "@/components/ui/SelectMenu";
import { TYPE_TO_CATEGORY } from "@/lib/catalog/browse";
import { useSetting } from "@/components/settings/SettingsProvider";
import { VoiceSearchButton } from "@/components/search/VoiceSearchButton";

// Canonical 24-wilaya list (previously a truncated 16 here).
const GOVERNORATES = TUNISIAN_GOVERNORATES;

// Type keys are stable; labels come from `property.types.<key>` so each
// locale (ar/fr/en) gets its own translation through the same i18n file.
const TYPE_KEYS = [
  "apartment", "villa", "house", "land", "farm", "commercial", "office", "warehouse",
] as const;

/** The deal tabs of the hero search; the text is `catalogue.deal.<key>`. */
const DEALS = ["all", "sale", "rent"] as const;
type Deal = (typeof DEALS)[number];

/**
 * Home search — keyword + governorate + type, submits to /annonces.
 *
 * This is the marketplace's primary action: an inline search the moment a
 * visitor lands. Without it the home reads as a magazine (browse-by-scroll);
 * with it, intent-driven users jump straight to a filtered catalogue.
 *
 * Three layouts:
 *   "hero"    — the redesign's floating white card (2026-10-31): a deal
 *               switch (tout · à vendre · à louer) over one row of keyword,
 *               governorate, type and the button; the row stacks on a phone.
 *               The same card on the phone and the desktop.
 *   "stacked" — the older two-row card (kept for any caller that still asks).
 *   "bar"     — the older single desktop row.
 *
 * Submits via `router.push` so the next-intl locale prefix is added
 * automatically and the navigation stays inside the SPA cache.
 */
export function HomeSearch({
  isRTL: _isRTL,
  layout = "hero",
}: {
  isRTL: boolean;
  layout?: "stacked" | "bar" | "hero";
}) {
  void _isRTL;
  const router = useRouter();
  const t = useTranslations();
  const locale = useLocale();
  const arabicRedirect = useSetting("feature_arabic_redirect");
  const [q, setQ] = useState("");
  const [gov, setGov] = useState("");
  const [del, setDel] = useState("");
  const [type, setType] = useState("");
  const [deal, setDeal] = useState<Deal>("all");
  // A délégation belongs to one governorate: changing it starts over.
  const pickGov = (g: string) => {
    setGov(g);
    setDel("");
  };

  const govOptions: SelectOption[] = [
    { value: "", label: t("search.allWilayas") },
    // The value stays the stored French name; only the label is translated.
    ...GOVERNORATES.map((g) => ({ value: g, label: governorateLabel(g, locale) })),
  ];
  const delOptions: SelectOption[] = [
    { value: "", label: t("search.allDelegations") },
    ...delegationsOf(gov)
      .map((d) => ({ value: d, label: delegationLabel(d, locale) }))
      .sort((a, b) => a.label.localeCompare(b.label, locale)),
  ];
  const typeOptions: SelectOption[] = [
    { value: "", label: t("search.allTypes") },
    ...TYPE_KEYS.map((k) => ({ value: k, label: t(`property.types.${k}`) })),
  ];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    // Strip ilike wildcards + `or()` separators here so the catalogue's
    // server query doesn't have to re-clean the same input.
    const cleanQ = normalizeSearchQuery(q);
    if (deal !== "all") params.set("deal", deal);
    if (cleanQ) params.set("q", cleanQ);
    if (gov) params.set("gov", gov);
    if (gov && del) params.set("del", del);
    // The catalogue filters by CATEGORY. This used to send `types=` — the
    // auction-era explore page's parameter — through a redirect to a page that
    // never reads it, so choosing « Villa » searched everything.
    if (type && TYPE_TO_CATEGORY[type]) params.set("cat", TYPE_TO_CATEGORY[type]);
    const qs = params.toString();
    // Typed in Arabic on the French site: answered in Arabic, and remembered —
    // unless an admin switched that off.
    if (arabicRedirect && locale === "fr" && isMostlyArabic(cleanQ)) {
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
  }

  if (layout === "hero") {
    const field =
      "tap-target flex h-12 w-full items-center gap-2 rounded-xl bg-surface-2 px-3.5 text-[13.5px] font-bold text-foreground transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/40 hover:bg-surface-3/60";
    return (
      <form onSubmit={submit} className="mazed-float p-2.5 text-start sm:p-3" role="search">
        {/* Buy or rent first: the one question that changes every other filter. */}
        <div
          role="tablist"
          aria-label={t("catalogue.dealAria")}
          className="mazed-segment w-full sm:w-auto"
          // The tabs pattern: the arrows move between the three, Home and End
          // jump to the ends; only the chosen tab is in the Tab order.
          onKeyDown={(e) => {
            const i = DEALS.indexOf(deal);
            const next =
              e.key === "ArrowRight" || e.key === "ArrowDown" ? (i + 1) % DEALS.length
              : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i - 1 + DEALS.length) % DEALS.length
              : e.key === "Home" ? 0
              : e.key === "End" ? DEALS.length - 1
              : -1;
            if (next < 0) return;
            e.preventDefault();
            setDeal(DEALS[next]);
            (e.currentTarget.children[next] as HTMLElement | undefined)?.focus();
          }}
        >
          {DEALS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={deal === k}
              tabIndex={deal === k ? 0 : -1}
              onClick={() => setDeal(k)}
              className="tap-target"
            >
              {t(`catalogue.deal.${k}`)}
            </button>
          ))}
        </div>

        <div className="mt-2.5 flex flex-col gap-2 lg:flex-row lg:items-stretch">
          {/* Keyword absorbs the free space. */}
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 size-[18px] -translate-y-1/2 text-muted ltr:left-4 rtl:right-4"
              strokeWidth={2}
              aria-hidden
            />
            {/* 16px text: iOS zooms the whole page into any smaller input on focus. */}
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("search.placeholder")}
              aria-label={t("search.placeholder")}
              enterKeyHint="search"
              className="h-12 w-full rounded-xl bg-surface-2 text-[16px] text-foreground placeholder:text-muted focus:bg-surface focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/30 ltr:pl-11 ltr:pr-12 rtl:pl-12 rtl:pr-11 lg:text-[14.5px]"
            />
            <VoiceSearchButton className="absolute end-1 top-1/2 -translate-y-1/2" />
          </div>

          <div className="grid grid-cols-2 gap-2 lg:flex lg:shrink-0">
            <div className="min-w-0 lg:w-48">
              <SelectMenu
                value={gov}
                onChange={pickGov}
                options={govOptions}
                ariaLabel={t("search.governorate")}
                icon={<MapPin className="size-4 shrink-0 text-muted" strokeWidth={2} aria-hidden />}
                triggerClassName={field}
              />
            </div>
            <div className="min-w-0 lg:w-44">
              <SelectMenu
                value={type}
                onChange={setType}
                options={typeOptions}
                ariaLabel={t("search.type")}
                align="end"
                icon={<Home className="size-4 shrink-0 text-muted" strokeWidth={2} aria-hidden />}
                triggerClassName={field}
              />
            </div>
            {gov && (
              <div className="col-span-2 min-w-0 lg:w-48">
                <SelectMenu
                  value={del}
                  onChange={setDel}
                  options={delOptions}
                  ariaLabel={t("search.delegation")}
                  icon={<MapPin className="size-4 shrink-0 text-muted" strokeWidth={2} aria-hidden />}
                  triggerClassName={field}
                />
              </div>
            )}
          </div>

          <button
            type="submit"
            className="mazed-btn-luxe tap-target inline-flex h-12 shrink-0 items-center justify-center gap-2 px-6 text-[14px]"
          >
            <Search className="size-4" strokeWidth={2.5} aria-hidden />
            {t("search.submit")}
          </button>
        </div>
      </form>
    );
  }

  // Desktop hero variant — one horizontal row: keyword | governorate |
  // type | submit, divided by hairlines, no outer section padding so the
  // caller controls width + centering.
  if (layout === "bar") {
    return (
      <form
        onSubmit={submit}
        className="flex items-stretch gap-2 rounded-2xl bg-surface p-2 text-start ring-1 ring-border shadow-[0_14px_40px_-18px_rgba(15,23,42,0.25)]"
      >
        {/* Keyword absorbs the free space; the two selects size to their
            own (sometimes long) labels via shrink-0 so nothing clips. */}
        <div className="relative flex min-w-0 flex-1 items-center">
          <Search
            className="pointer-events-none absolute size-4 text-muted ltr:left-4 rtl:right-4"
            strokeWidth={2}
          />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("search.placeholder")}
            aria-label={t("search.placeholder")}
            className="w-full rounded-xl bg-transparent py-3.5 text-[14px] text-foreground placeholder:text-muted focus:outline-none px-11"
          />
          <VoiceSearchButton className="absolute end-1 top-1/2 -translate-y-1/2" />
        </div>
        <div className="my-1.5 w-px shrink-0 bg-border" />
        <SelectMenu
          value={gov}
          onChange={pickGov}
          options={govOptions}
          ariaLabel={t("search.governorate")}
          icon={<MapPin className="size-4 shrink-0 text-gold" strokeWidth={2} aria-hidden />}
          triggerClassName="flex w-44 shrink-0 cursor-pointer items-center gap-2 bg-transparent px-3.5 py-3.5 text-[13px] font-bold text-foreground focus:outline-none"
        />
        <div className="my-1.5 w-px shrink-0 bg-border" />
        <SelectMenu
          value={type}
          onChange={setType}
          options={typeOptions}
          ariaLabel={t("search.type")}
          align="end"
          triggerClassName="flex w-36 shrink-0 cursor-pointer items-center gap-2 bg-transparent px-4 py-3.5 text-[13px] font-bold text-foreground focus:outline-none"
        />
        <button
          type="submit"
          className="mazed-btn-luxe inline-flex shrink-0 items-center gap-2 px-7 text-[13px] font-extrabold transition active:scale-[0.98]"
        >
          <Search className="size-4" strokeWidth={2.5} />
          {t("search.submit")}
        </button>
      </form>
    );
  }

  // No side padding of its own: the home page's wrapper already gives it the
  // 16px gutter the cards above it have. With both, the card sat 32px in from
  // each edge, narrower than everything around it.
  return (
    <section>
      <form
        onSubmit={submit}
        className="rounded-2xl bg-surface p-2 ring-1 ring-gold/20"
      >
        {/* Top row: keyword box + submit. Stays single-row even on
            narrow phones — the type + governorate pickers drop below. */}
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-muted ltr:left-3.5 rtl:right-3.5"
              strokeWidth={2}
            />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("search.placeholder")}
              aria-label={t("search.placeholder")}
              className="w-full rounded-full bg-surface-2 py-3 text-[13px] text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-gold/40 ltr:pl-9 ltr:pr-10 rtl:pl-10 rtl:pr-9"
            />
            <VoiceSearchButton className="absolute end-0.5 top-1/2 -translate-y-1/2" />
          </div>
          <button
            type="submit"
            className="mazed-btn-luxe tap-target inline-flex size-11 shrink-0 items-center justify-center rounded-full"
            aria-label={t("search.submit")}
          >
            <Search className="size-4" strokeWidth={2.5} />
          </button>
        </div>

        {/* Second row: two soft-pill custom dropdowns (matching menus,
            chevron affordance, gold-checked selection).
            They wrap. Side by side they need about 330px, and « Tous les
            gouvernorats » would not shrink below its text: at 320px the row
            ran 50px past the screen and the whole page scrolled sideways. Now
            each pill is at least 10rem and `min-w-0`, so under ~380px they
            stack full width, and above it a long label truncates inside its
            pill instead of pushing it out. */}
        <div className="mt-2 flex flex-wrap gap-2">
          <div className="min-w-0 flex-[1_1_10rem]">
            <SelectMenu
              value={gov}
              onChange={pickGov}
              options={govOptions}
              ariaLabel={t("search.governorate")}
              icon={<MapPin className="size-3.5 shrink-0 text-gold" strokeWidth={2} aria-hidden />}
              triggerClassName="tap-target flex w-full items-center gap-2 rounded-full bg-surface-2 px-3 py-2.5 text-[12px] font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-gold/40"
            />
          </div>
          {gov && (
            <div className="min-w-0 basis-full">
              <SelectMenu
                value={del}
                onChange={setDel}
                options={delOptions}
                ariaLabel={t("search.delegation")}
                icon={<MapPin className="size-3.5 shrink-0 text-muted" strokeWidth={2} aria-hidden />}
                triggerClassName="tap-target flex w-full items-center gap-2 rounded-full bg-surface-2 px-3 py-2.5 text-[12px] font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-gold/40"
              />
            </div>
          )}
          <div className="min-w-0 flex-[1_1_10rem]">
            <SelectMenu
              value={type}
              onChange={setType}
              options={typeOptions}
              ariaLabel={t("search.type")}
              align="end"
              triggerClassName="tap-target flex w-full items-center gap-2 rounded-full bg-surface-2 px-3 py-2.5 text-[12px] font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-gold/40"
            />
          </div>
        </div>
      </form>
    </section>
  );
}
