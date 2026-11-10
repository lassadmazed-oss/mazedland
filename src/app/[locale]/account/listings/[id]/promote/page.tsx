import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { annoncePhotoUrl } from "@/lib/imageUrl";
import { formatDate, formatTND } from "@/lib/utils";
import { ArrowLeft, ExternalLink, Info, Megaphone } from "lucide-react";
import {
  OFFERED_CHANNELS, OPEN_REQUEST_STATUSES, SOCIAL_LANGUAGES, isFeaturedRequest,
  type JobStatus, type RequestStatus, type SocialChannel, type SocialLanguage,
} from "@/lib/social/channels";
import { buildVariants, loadSocialListing, socialOrigin, socialSettings, tunisToday } from "@/lib/social/server";
import { paymentsAreOpen } from "@/lib/payments/server";
import { PaymentsClosedNotice } from "@/components/payments/PaymentsClosedNotice";
import { PromoteForm } from "./PromoteForm";
import { WithdrawButton } from "./WithdrawButton";

export const dynamic = "force-dynamic";

type JobRow = {
  channel: SocialChannel;
  group_id: string | null;
  action: string;
  status: JobStatus;
  external_url: string | null;
  published_at: string | null;
};

type RequestRow = {
  id: string;
  ref: string;
  status: RequestStatus;
  channels: SocialChannel[];
  language: SocialLanguage;
  consent_at: string | null;
  /** Set when an admin put the annonce forward (0214); the auto-queue has none, its consent says « terms-… ». */
  initiated_by: string | null;
  consent_version: string | null;
  price_tnd: number | string;
  rejection_reason: string | null;
  created_at: string;
  jobs: JobRow[] | null;
};

const TONE: Record<string, string> = {
  pending_approval: "mazed-tone-warn",
  scheduled: "mazed-tone-warn",
  published: "mazed-tone-ok",
  failed: "mazed-tone-bad",
  rejected: "mazed-tone-bad",
  cancelled: "bg-surface-2 text-muted ring-1 ring-border",
  withdrawn: "bg-surface-2 text-muted ring-1 ring-border",
};

/**
 * Promouvoir mon annonce (cahier « Mazed Social Publisher » §3): the form
 * opens ready — every channel the annonce can go on, in the page's language —
 * and the seller unticks what they do not want, sees the posts as they will
 * read, sees the price, and agrees in so many words, with the one tap that
 * sends it for review. Once asked, the same page shows where it stands, the links to
 * the posts, the visits they brought, and the way to take it all back.
 */
/** The tab's title: every page of this section used to carry the site's home title. */
export async function generateMetadata() {
  const t = await getTranslations("promote");
  return { title: t("title") };
}

export default async function PromotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = await getLocale();
  const t = await getTranslations("promote");
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/account/listings/${id}/promote`)}`);

  const admin = getServiceSupabase();
  if (!admin) notFound();
  const row = await loadSocialListing(admin, id);
  if (!row || row.seller_id !== user!.id) notFound();

  const [settings, { data: reqRows }] = await Promise.all([
    socialSettings(admin),
    admin
      .from("social_publication_requests")
      .select(
        "id, ref, status, channels, language, consent_at, initiated_by, consent_version, price_tnd, rejection_reason, created_at, jobs:social_publication_jobs (channel, group_id, action, status, external_url, published_at)",
      )
      .eq("listing_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  // Two lanes (0215): the seller's own ask — where it stands, or the form —
  // and, beside it, the one Mazed made for its pages (« Proposée par Mazed Immo »).
  const asks = (reqRows ?? []) as RequestRow[];
  const live = (r: RequestRow) => (OPEN_REQUEST_STATUSES as readonly string[]).includes(r.status);
  const last = asks.find((r) => !isFeaturedRequest(r)) ?? null;
  const open = last && live(last) ? last : null;
  const featured = asks.find((r) => isFeaturedRequest(r) && live(r)) ?? null;
  // Free at launch. Once it has a price it is paid like the rest, and with no
  // payee to pay the form is not offered — the API refuses too
  // (`payments_closed`), so nobody fills it in to be told no at the end.
  const closed = settings.priceTnd > 0 && !open && !(await paymentsAreOpen());

  const stats = new Map<string, { visits: number; contacts: number }>();
  const shown = [featured, open].filter((r): r is RequestRow => r !== null);
  if (shown.length > 0) {
    const { data: events } = await admin
      .from("social_tracking_events")
      .select("request_id, event")
      .in("request_id", shown.map((r) => r.id));
    for (const e of (events ?? []) as { request_id: string; event: string }[]) {
      const s = stats.get(e.request_id) ?? { visits: 0, contacts: 0 };
      if (e.event === "visit") s.visits += 1;
      else if (e.event === "contact") s.contacts += 1;
      stats.set(e.request_id, s);
    }
  }

  // Every channel in every language, so switching in the form is instant.
  // The reference is given when the request is made; the preview shows its shape.
  const origin = socialOrigin();
  const today = tunisToday();
  const previews = Object.fromEntries(
    SOCIAL_LANGUAGES.map((language) => [
      language,
      Object.fromEntries(
        buildVariants({ row, channels: [...OFFERED_CHANNELS], language, origin, ref: "XXXXXX", today }).map((v) => [v.channel, v.body]),
      ),
    ]),
  ) as Record<SocialLanguage, Record<SocialChannel, string>>;
  const photos = row.photos.slice(0, 4).map((p) => annoncePhotoUrl(p, 640, 70));

  const channelState = (ask: RequestRow, channel: SocialChannel) => {
    const jobs = (ask.jobs ?? []).filter((j) => j.channel === channel && j.action === "publish" && j.status !== "cancelled");
    if (channel === "facebook_groups") {
      const shared = jobs.filter((j) => j.status === "published").length;
      return { label: shared > 0 ? t("groupsShared", { count: shared }) : t("job.groups"), url: null };
    }
    const job = jobs[0];
    if (!job) return { label: t(`status.${ask.status}`), url: null };
    return { label: t(`job.${job.status}`), url: job.status === "published" ? job.external_url : null };
  };

  // Where an ask stands: its pages and their posts, the visits they brought, the way back.
  const askSection = (ask: RequestRow) => {
    const s = stats.get(ask.id) ?? { visits: 0, contacts: 0 };
    return (
      <section key={ask.id} className="mt-6 rounded-2xl border border-border bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[14px] font-extrabold text-foreground">
            {t(isFeaturedRequest(ask) ? "featuredOn" : "askedOn", { date: formatDate(ask.created_at, locale, "medium") })}
          </p>
          <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold ${TONE[ask.status] ?? ""}`}>
            {t(`status.${ask.status}`)}
          </span>
        </div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{t(`statusHint.${ask.status}`)}</p>

        <ul className="mt-4 divide-y divide-border rounded-xl ring-1 ring-border">
          {ask.channels.map((c) => {
            const state = channelState(ask, c);
            return (
              <li key={c} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <span className="text-[13px] font-bold text-foreground">{t(`channels.${c}.name`)}</span>
                {state.url ? (
                  <a
                    href={state.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[12.5px] font-bold text-gold hover:underline"
                  >
                    {t("seePost")} <ExternalLink className="size-3.5" />
                  </a>
                ) : (
                  <span className="text-[12.5px] text-muted">{state.label}</span>
                )}
              </li>
            );
          })}
        </ul>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-surface-2 p-3 text-center ring-1 ring-border">
            <p className="mazed-tabular text-[20px] font-extrabold text-foreground">{s.visits}</p>
            <p className="text-[11.5px] text-muted">{t("visits")}</p>
          </div>
          <div className="rounded-xl bg-surface-2 p-3 text-center ring-1 ring-border">
            <p className="mazed-tabular text-[20px] font-extrabold text-foreground">{s.contacts}</p>
            <p className="text-[11.5px] text-muted">{t("contacts")}</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-muted">
          <span>
            {t("ref")} <span className="mazed-tabular font-bold text-foreground" dir="ltr">MZ-{ask.ref}</span>
            {" · "}
            {Number(ask.price_tnd) > 0 ? t("paid", { amount: formatTND(Number(ask.price_tnd), "fr") }) : t("free")}
          </span>
          <WithdrawButton requestId={ask.id} published={ask.status !== "pending_approval"} />
        </div>
      </section>
    );
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 lg:max-w-3xl lg:py-10">
      <Link
        href={"/account/listings" as never}
        className="inline-flex items-center gap-1 text-[12.5px] font-bold text-muted hover:text-foreground"
      >
        <ArrowLeft className="size-3.5 rtl:-scale-x-100" /> {t("back")}
      </Link>

      <div className="mt-3 flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-gold-faint text-gold ring-1 ring-gold-soft">
          <Megaphone className="size-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-[22px] font-extrabold tracking-tight lg:text-[26px]">{t("title")}</h1>
          <p className="mt-0.5 truncate text-[13px] text-muted" dir="auto">{row.title}</p>
        </div>
      </div>

      {featured && askSection(featured)}

      {open ? (
        askSection(open)
      ) : row.status !== "published" ? (
        <section className="mt-6 flex gap-3 rounded-2xl border border-border bg-surface-2/50 p-4 text-[13px] leading-relaxed text-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-muted" />
          <p>{t("notOnline")}</p>
        </section>
      ) : !settings.enabled ? (
        <section className="mt-6 flex gap-3 rounded-2xl border border-border bg-surface-2/50 p-4 text-[13px] leading-relaxed text-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-muted" />
          <p>{t("disabled")}</p>
        </section>
      ) : closed ? (
        <PaymentsClosedNotice className="mt-6" title={t("closed.title")} body={t("closed.body")} contactLabel={t("closed.contact")} />
      ) : (
        <>
          {last?.status === "rejected" && (
            <section className="mt-6 rounded-2xl mazed-tone-bad p-4 text-[13px] leading-relaxed">
              <p className="font-bold">{t("lastRejected")}</p>
              {last.rejection_reason && <p className="mt-1" dir="auto">{last.rejection_reason}</p>}
            </section>
          )}
          <PromoteForm
            listingId={row.id}
            previews={previews}
            photos={photos}
            hasPhotos={row.photos.length > 0}
            priceTnd={settings.priceTnd}
            covered={featured?.channels ?? []}
          />
        </>
      )}
    </main>
  );
}
