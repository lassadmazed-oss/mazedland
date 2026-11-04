import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { loadOffers } from "@/lib/offers-server";
import { shownStatus } from "@/lib/offers";
import { OfferCard } from "@/components/offers/OfferCard";

export const dynamic = "force-dynamic";

/** The tab's title. */
export async function generateMetadata() {
  const t = await getTranslations("offers.page");
  return { title: t("title") };
}

/**
 * Mes offres (0211): the prices proposed on my annonces, and the ones I
 * proposed. A shop's team also answers its annonces' offers in the Espace Pro.
 */
export default async function MyOffersPage({ searchParams }: { searchParams: Promise<{ tab?: string; o?: string }> }) {
  const sp = await searchParams;
  const locale = await getLocale();
  const t = await getTranslations("offers.page");
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/account/offres`)}`);
  const admin = getServiceSupabase();
  if (!admin) return <p className="p-6 text-[13px] text-muted">{t("unavailable")}</p>;

  const [received, sent] = await Promise.all([loadOffers(admin, { seller: user!.id }), loadOffers(admin, { buyer: user!.id })]);
  // Without a tab: where the offer named in the link is, else where something waits, else what I sent.
  const tab =
    sp.tab === "sent" || sp.tab === "received"
      ? sp.tab
      : sp.o && sent.some((o) => o.id === sp.o)
        ? "sent"
        : received.length > 0
          ? "received"
          : "sent";
  const list = tab === "received" ? received : sent;
  // What waits on me: an offer to answer on my annonces, a seller's price to answer on mine.
  const waiting = {
    received: received.filter((o) => shownStatus(o) === "pending").length,
    sent: sent.filter((o) => shownStatus(o) === "countered").length,
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 lg:py-10">
      <h1 className="mazed-h2 text-[26px] text-foreground lg:text-[32px]">{t("title")}</h1>
      <p className="mt-1 text-[13px] text-muted">{t("subtitle")}</p>

      <nav className="mazed-segment mt-5 w-full sm:w-auto">
        {(["received", "sent"] as const).map((k) => (
          <Link
            key={k}
            href={`/account/offres?tab=${k}` as never}
            aria-current={tab === k ? "page" : undefined}
            className="gap-1.5"
          >
            {t(`tabs.${k}`)}
            {waiting[k] > 0 && <span className="mazed-tabular text-[11px] text-[var(--tone-warn)]">{waiting[k]}</span>}
          </Link>
        ))}
      </nav>

      {list.length === 0 ? (
        <p className="mazed-band-warm mt-6 rounded-[var(--radius-3xl)] p-8 text-center text-[13.5px] leading-relaxed text-muted lg:p-12">
          {t(tab === "received" ? "emptyReceived" : "emptySent")}
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {list.map((o) => (
            <OfferCard key={o.id} offer={o} side={tab === "received" ? "seller" : "buyer"} locale={locale} highlight={o.id === sp.o} />
          ))}
        </div>
      )}
    </main>
  );
}
