import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { isRtl } from "@/lib/i18n";
import { getSettings } from "@/lib/settings/server";
import { ArrowUpRight, BarChart3, ClipboardCheck, Lock, Phone, Plus, Scale, Search, ShieldCheck } from "lucide-react";

/**
 * The two bands that close the home page, in both layouts (2026-10-31).
 *
 * WhyBand — what protects the visitor, and how the site works: the four
 * pillars and the three steps that used to be five separate sections
 * (« Comment ça marche », « Pourquoi Mazed Immo », the trust strip, the
 * closing spread) saying the same things twice.
 *
 * SellBand — the one dark block of the page: the call to publish, for the
 * visitor who scrolled to the end and has something to sell or let.
 */

// Trust pillars — what protects the user. The four things Mazed Immo
// actually does: it checks every annonce before it goes up, it never
// publishes a phone number, it verifies sellers who ask to be, and it takes
// no cut of the sale.
const TRUST_PILLARS: {
  key: string;
  titleKey: string;
  bodyKey: string;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}[] = [
  { key: "checked",  titleKey: "home.trustEscrowTitle",     bodyKey: "home.trustEscrowBody",     Icon: ClipboardCheck },
  { key: "privacy",  titleKey: "home.trustKycTitle",        bodyKey: "home.trustKycBody",        Icon: Lock },
  { key: "verified", titleKey: "home.trustInspectionTitle", bodyKey: "home.trustInspectionBody", Icon: ShieldCheck },
  { key: "nofee",    titleKey: "home.trustLegalTitle",      bodyKey: "home.trustLegalBody",      Icon: Scale },
];

// "How it works" — the 3-step buyer journey.
const HOW_IT_WORKS: {
  key: string;
  eyebrowKey: string;
  titleKey: string;
  bodyKey: string;
  href: string;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}[] = [
  { key: "browse",  eyebrowKey: "home.step1Eyebrow", titleKey: "home.step1Title", bodyKey: "home.step1Body", href: "/annonces", Icon: Search },
  { key: "call",    eyebrowKey: "home.step2Eyebrow", titleKey: "home.step2Title", bodyKey: "home.step2Body", href: "/annonces", Icon: Phone },
  { key: "publish", eyebrowKey: "home.step3Eyebrow", titleKey: "home.step3Title", bodyKey: "home.step3Body", href: "/annonces/nouvelle", Icon: Plus },
];

export async function WhyBand({ layout }: { layout: "phone" | "desktop" }) {
  const t = await getTranslations();
  const arabic = isRtl(await getLocale()) ? "font-arabic" : "";
  const desktop = layout === "desktop";
  // « Le marché en chiffres » (/marche): the site's own figures, while the console keeps the page on.
  const { public_stats_enabled: marketOn } = await getSettings();

  return (
    <section
      className={`mazed-section mazed-band-warm ${desktop ? "rounded-[var(--radius-3xl)] px-10 py-14" : "px-4 py-10"}`}
      aria-labelledby={`home-why-${layout}`}
    >
      <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-subtle">{t("home.trustEyebrow")}</p>
      <h2 id={`home-why-${layout}`} className={`mazed-h2 mt-1.5 max-w-xl text-foreground ${desktop ? "text-[32px]" : "text-[24px]"} ${arabic}`}>
        {t("home.trustTitle")}
      </h2>

      <ul className={`mt-6 grid gap-3 ${desktop ? "grid-cols-4 gap-4" : "grid-cols-2"}`}>
        {TRUST_PILLARS.map((p) => (
          <li key={p.key} className={`rounded-2xl bg-surface ring-1 ring-border ${desktop ? "p-5" : "p-3.5"}`}>
            <span className="inline-grid size-9 place-items-center rounded-full bg-foreground text-[var(--background)]">
              <p.Icon className="size-4" strokeWidth={2.2} />
            </span>
            <p className={`mt-3 font-bold leading-tight text-foreground ${desktop ? "text-[15px]" : "text-[13.5px]"} ${arabic}`}>
              {t(p.titleKey)}
            </p>
            <p className={`mt-1 leading-relaxed text-muted ${desktop ? "text-[13px]" : "text-[12px]"} ${arabic}`}>{t(p.bodyKey)}</p>
          </li>
        ))}
      </ul>

      {/* The proof behind the pillars: the market's own figures, public. */}
      {marketOn && (
        <Link
          href={"/marche" as never}
          className={`group mt-3 flex items-center gap-3.5 rounded-2xl bg-surface ring-1 ring-border transition hover:ring-foreground/40 ${desktop ? "mt-4 p-5" : "p-4"}`}
        >
          <span className="inline-grid size-9 shrink-0 place-items-center rounded-full bg-foreground text-[var(--background)]">
            <BarChart3 className="size-4" strokeWidth={2.2} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block font-bold leading-tight text-foreground ${desktop ? "text-[15px]" : "text-[14px]"} ${arabic}`}>{t("home.marketTitle")}</span>
            <span className={`mt-1 block leading-relaxed text-muted ${desktop ? "text-[13px]" : "text-[12px]"} ${arabic}`}>{t("home.marketBody")}</span>
          </span>
          <ArrowUpRight className="size-4 shrink-0 text-subtle transition group-hover:text-foreground rtl:-scale-x-100" strokeWidth={2.2} aria-hidden />
        </Link>
      )}

      {/* The journey, as three numbered rows: the order is the information. */}
      <p className="mt-10 text-[11px] font-extrabold uppercase tracking-[0.14em] text-subtle">{t("home.howItWorksEyebrow")}</p>
      <h3 className={`mazed-h2 mt-1.5 text-foreground ${desktop ? "text-[24px]" : "text-[20px]"} ${arabic}`}>{t("home.howItWorksTitle")}</h3>
      <ol className={`mt-5 grid gap-3 ${desktop ? "grid-cols-3 gap-4" : ""}`}>
        {HOW_IT_WORKS.map((step, i) => (
          <li key={step.key}>
            <Link
              href={step.href as never}
              className="group flex h-full items-start gap-3.5 rounded-2xl bg-surface p-4 ring-1 ring-border transition hover:ring-foreground/40"
            >
              <span className="mazed-tabular inline-grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-[13px] font-extrabold text-foreground ring-1 ring-border">
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className={`block text-[14.5px] font-bold leading-tight text-foreground ${arabic}`}>{t(step.titleKey)}</span>
                <span className={`mt-1 block text-[12.5px] leading-relaxed text-muted ${arabic}`}>{t(step.bodyKey)}</span>
              </span>
              <ArrowUpRight className="ms-auto size-4 shrink-0 text-subtle transition group-hover:text-foreground rtl:-scale-x-100" strokeWidth={2.2} aria-hidden />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

export async function SellBand({ layout }: { layout: "phone" | "desktop" }) {
  const t = await getTranslations();
  const arabic = isRtl(await getLocale()) ? "font-arabic" : "";
  const desktop = layout === "desktop";

  return (
    <section className={`mazed-section ${desktop ? "" : "px-4"}`} aria-labelledby={`home-sell-${layout}`}>
      <div className={`mazed-band-ink relative overflow-hidden rounded-[var(--radius-3xl)] ${desktop ? "px-14 py-16" : "px-6 py-10"}`}>
        {/* The mark, as a watermark: the one place the logo's gold meets the ink. */}
        <Image
          src="/logo-watermark.webp"
          alt=""
          width={535}
          height={720}
          sizes="420px"
          className="pointer-events-none absolute -bottom-16 -end-10 h-[150%] w-auto select-none opacity-[0.12]"
        />
        <div className="relative max-w-2xl">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/60">{t("home.sellShort")}</p>
          <h2 id={`home-sell-${layout}`} className={`mazed-h2 mt-2 text-[var(--background)] ${desktop ? "text-[40px]" : "text-[26px]"} ${arabic}`}>
            {t("home.sellBandTitle")}
          </h2>
          <p className={`mt-3 max-w-xl leading-relaxed text-white/75 ${desktop ? "text-[16px]" : "text-[14px]"} ${arabic}`}>
            {t("home.sellBandBody")}
          </p>
          <Link
            href={"/annonces/nouvelle" as never}
            className="tap-target mt-6 inline-flex h-12 items-center gap-2 rounded-full bg-[var(--background)] px-6 text-[14px] font-extrabold text-foreground transition hover:bg-surface-2 active:scale-[0.98]"
          >
            <Plus className="size-4" strokeWidth={2.5} aria-hidden />
            {t("home.sellBandCta")}
          </Link>
        </div>
      </div>
    </section>
  );
}
