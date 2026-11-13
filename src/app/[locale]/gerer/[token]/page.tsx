import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { findManagedListing } from "@/lib/prospection/server";
import { ManageActions } from "./ManageActions";

// A private page: it depends on its link alone, and no search engine or referrer may carry it away.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("manage");
  return { title: t("title"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

/**
 * The page behind the private link in the SMS an owner gets when the Mazed team
 * puts their annonce online (Prospection, 0218). It says where the annonce
 * stands and offers the two things an owner asks for first — « vendue » and
 * « retirer » — without a password. Everything else (editing, renewing) is
 * the owner's account, reached with the phone number and a code by SMS.
 */
export default async function ManagePage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  const t = await getTranslations("manage");
  const admin = getServiceSupabase();
  const listing = admin ? await findManagedListing(admin, token) : null;

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-10">
      {!listing ? (
        <div className="rounded-2xl bg-surface p-6 ring-1 ring-border">
          <h1 className="text-[20px] font-extrabold">{t("invalidTitle")}</h1>
          <p className="mt-2 text-[14px] leading-relaxed text-muted">{t("invalidBody")}</p>
          <Link href="/login" className="mt-4 inline-flex h-10 items-center rounded-full bg-foreground px-5 text-[13px] font-bold text-[var(--background)]">
            {t("login")}
          </Link>
        </div>
      ) : (
        <div className="rounded-2xl bg-surface p-6 ring-1 ring-border">
          <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-muted">{t("eyebrow")}</p>
          <h1 dir="auto" className="mt-1 break-words text-[20px] font-extrabold">{listing.title}</h1>
          <p className="mt-2 text-[14px] text-muted">{t(`status.${listing.status}`)}</p>
          <ManageActions token={token} status={listing.status} rent={listing.deal_type === "rent"} locale={locale} listingId={listing.id} />
          <p className="mt-6 border-t border-border pt-4 text-[12.5px] leading-relaxed text-muted">{t("account")}</p>
        </div>
      )}
    </main>
  );
}
