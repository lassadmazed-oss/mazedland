import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { loadQuestions } from "@/lib/price-questions-server";
import { QuestionCard } from "@/components/price-questions/QuestionCard";

export const dynamic = "force-dynamic";

/** The tab's title. */
export async function generateMetadata() {
  const t = await getTranslations("priceQuestions.page");
  return { title: t("title") };
}

/**
 * Demandes de prix (0222): the questions on my annonces « sur demande », and
 * the ones I asked. A shop's client who asked is also in its clients.
 */
export default async function MyPriceQuestionsPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const sp = await searchParams;
  const locale = await getLocale();
  const t = await getTranslations("priceQuestions.page");
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/account/prix`)}`);
  const admin = getServiceSupabase();
  if (!admin) return <p className="p-6 text-[13px] text-muted">{t("unavailable")}</p>;

  const [received, sent] = await Promise.all([loadQuestions(admin, { seller: user!.id }), loadQuestions(admin, { buyer: user!.id })]);
  // Without a tab: where the question named in the link is, else where one waits, else what I asked.
  const tab =
    sp.tab === "sent" || sp.tab === "received"
      ? sp.tab
      : sp.q && sent.some((q) => q.id === sp.q)
        ? "sent"
        : received.length > 0
          ? "received"
          : "sent";
  const list = tab === "received" ? received : sent;
  const waiting = {
    received: received.filter((q) => q.status === "open").length,
    sent: 0,
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 lg:py-10">
      <h1 className="mazed-h2 text-[26px] text-foreground lg:text-[32px]">{t("title")}</h1>
      <p className="mt-1 text-[13px] text-muted">{t("subtitle")}</p>

      <nav className="mazed-segment mt-5 w-full sm:w-auto">
        {(["received", "sent"] as const).map((k) => (
          <Link key={k} href={`/account/prix?tab=${k}` as never} aria-current={tab === k ? "page" : undefined} className="gap-1.5">
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
          {list.map((q) => (
            <QuestionCard key={q.id} question={q} side={tab === "received" ? "seller" : "buyer"} locale={locale} highlight={q.id === sp.q} />
          ))}
        </div>
      )}
    </main>
  );
}
