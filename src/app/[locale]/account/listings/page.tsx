import { redirect } from "next/navigation";
import { coverPhoto } from "@/lib/listingCover";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { ListingImage } from "@/components/media/ListingImage";
import { cn, formatDate, formatTND } from "@/lib/utils";
import { asDealType } from "@/lib/listings/deal";
import { isEditable } from "@/lib/listings/edit";
import { categoryLabel } from "@/lib/i18n";
import {
  Plus, Ticket, ImageOff, Clock, CreditCard, PencilLine,
  ArrowRight, AlertTriangle, Inbox, Megaphone, Sparkles, MessageCircle,
} from "lucide-react";
import { RenewButton } from "./RenewButton";
import { DeleteDraftButton } from "./DeleteDraftButton";
import { getSettings } from "@/lib/settings/server";
import { accountAllowance } from "@/lib/places/server";
import { holdsPlace, placesLeft, type Allowance } from "@/lib/places/model";
import { ListingStatusActions } from "./ListingStatusActions";
import { ShareButton } from "@/components/listing/ShareButton";
import { PaySubmitButton } from "@/components/payments/PaySubmitButton";

export const dynamic = "force-dynamic";

/**
 * Mes annonces — what the seller has, and what is waiting on whom.
 *
 * Rebuilt around the question this page is actually opened to answer: "is
 * anything blocked on me?". The four counts at the top used to be decoration —
 * you could read "2 à corriger" and then have to hunt for those two rows in a
 * list of thirty. They are tabs now, so the number and the way to act on it
 * are the same control.
 *
 * The second thing that was missing: a listing stuck at `pending_payment` had
 * no way forward from here at all — the seller had to dig up the notification
 * that carried the checkout link. Every row now offers the one action its
 * status implies: pay, resume the draft, renew, or view.
 */

/**
 * Chip colour per status, and whether the status has a hint line. The words
 * are `account.listings.status.*` / `statusHint.*` — seller-facing wording,
 * deliberately not shared with the admin console's.
 */
const STATUS: Record<string, { tone: string; hint?: true }> = {
  draft:           { tone: "bg-surface-2 text-muted ring-1 ring-border", hint: true },
  pending_payment: { tone: "mazed-tone-warn", hint: true },
  pending_review:  { tone: "mazed-tone-warn", hint: true },
  published:       { tone: "mazed-tone-ok" },
  rejected:        { tone: "mazed-tone-bad", hint: true },
  expired:         { tone: "bg-surface-2 text-muted ring-1 ring-border", hint: true },
  sold:            { tone: "mazed-tone-ok" },
  rented:          { tone: "mazed-tone-ok" },
  archived:        { tone: "bg-surface-2 text-muted ring-1 ring-border" },
};

/**
 * The tabs. `key` is what appears in the URL — French and readable, because a
 * seller who bookmarks "mes annonces à corriger" should not be looking at
 * `?statut=action_required`. It stays French on /ar too; `label` is the
 * message key under `account.listings.tabs`.
 *
 * Drafts and refused annonces are both "waiting on me", but not for the same
 * reason: a draft was never sent, a refused one came back from our team with
 * something to fix. One « À corriger » tab for both read as if every draft
 * had been refused.
 */
const TABS = [
  { key: "",             label: "all",        statuses: null,                                   tone: "text-foreground" },
  { key: "en-ligne",     label: "online",     statuses: ["published"],                          tone: "text-emerald-400" },
  { key: "verification", label: "inProgress", statuses: ["pending_payment", "pending_review"],  tone: "text-amber-400" },
  { key: "a-corriger",   label: "toFix",      statuses: ["rejected"],                           tone: "text-[var(--danger)]" },
  { key: "brouillons",   label: "drafts",     statuses: ["draft"],                              tone: "text-muted" },
  { key: "terminees",    label: "ended",      statuses: ["expired", "archived", "sold", "rented"], tone: "text-muted" },
] as const;

const RENEWABLE = ["expired", "archived", "sold", "rented"];

/** The title PublishWizard stores for a draft with none (a marker, not copy). */
const UNTITLED_DRAFT = "Brouillon";

/** The tab's title: every page of this section used to carry the site's home title. */
export async function generateMetadata() {
  const t = await getTranslations("account.listings");
  return { title: t("title") };
}

export default async function MyListingsPage({
  searchParams,
}: {
  searchParams: Promise<{ statut?: string }>;
}) {
  const sp = await searchParams;
  const locale = await getLocale();
  const t = await getTranslations("account.listings");
  const tAccount = await getTranslations("account");
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/account/listings`)}`);
  }

  const admin = getServiceSupabase();
  const db = admin ?? supabase;

  const [listRes, creditRes, payRes] = await Promise.all([
    db
      .from("listings")
      .select(
        `id, title, price, price_on_request, status, rejection_reason, published_at,
         deal_type, availability, pending_edit_at, review_flags, taken_down_at, taken_down_reason,
         expires_at, created_at, category_id, category:categories (label_fr, label_ar),
         photos:listing_photos (storage_path, sort_order, is_cover)`,
      )
      .eq("seller_id", user.id)
      .order("created_at", { ascending: false }),
    db
      .from("seller_credits")
      .select("quota_total, quota_used, expires_at, status")
      .eq("seller_id", user.id)
      .eq("status", "active"),
    // The open fee payment per listing, so "À payer" can be paid from this
    // page instead of only from the notification that announced it.
    //
    // The link is metadata.listing_id, NOT property_id: `payments.property_id`
    // is a foreign key to the auction-era `properties` table and cannot hold a
    // listing id at all. Matching on it would have compiled, run, and silently
    // never found a payment.
    db
      .from("payments")
      .select("id, metadata, status")
      .eq("user_id", user.id)
      .eq("kind", "listing_fee")
      .in("status", ["pending", "pending_review"]),
  ]);

  // Split by status: a receipt already with an admin is not a fee still to
  // pay, and both used to show « À payer » with a « Payer » button next to
  // money the seller had already sent.
  const payFor = new Map<string, string>();
  const reviewFor = new Map<string, string>();
  for (const p of (payRes.data ?? []) as { id: string; metadata: unknown; status: string }[]) {
    const listingId = (p.metadata as { listing_id?: string } | null)?.listing_id;
    if (!listingId) continue;
    const target = p.status === "pending_review" ? reviewFor : payFor;
    if (!target.has(listingId)) target.set(listingId, p.id);
  }

  const now = Date.now();
  const creditsLeft = (creditRes.data ?? []).reduce((n, c) => {
    if (new Date(c.expires_at as string).getTime() <= now) return n;
    return n + Math.max(0, (c.quota_total as number) - (c.quota_used as number));
  }, 0);

  const settings = await getSettings();
  // Places (src/lib/places): the plan of the agence this account owns, its
  // own annonces counted in it, or else its free places — the same count the
  // submit, renew and relist routes enforce. Without the service key (a dev
  // set-up), the free places are counted from the list above.
  const freeLimit = settings.free_listing_limit;
  const allowance: Allowance = admin
    ? await accountAllowance(admin, user.id, freeLimit)
    : (() => {
        const used = (listRes.data ?? []).filter((l) => holdsPlace(l.status as string)).length;
        return { kind: "free" as const, used, limit: freeLimit, left: placesLeft(used, freeLimit) };
      })();
  const freePlacesLeft = allowance.left;

  type Category = { label_fr: string; label_ar: string | null };
  type Row = {
    id: string; title: string; price: number | null; price_on_request: boolean;
    status: string; rejection_reason: string | null; published_at: string | null;
    expires_at: string | null; created_at: string;
    deal_type: string | null; availability: string | null; pending_edit_at: string | null;
    review_flags: string[] | null;
    taken_down_at: string | null; taken_down_reason: string | null;
    category: Category | Category[] | null;
    category_id: string;
    photos: { storage_path: string; sort_order: number; is_cover?: boolean | null }[] | null;
  };
  const all = (listRes.data ?? []) as Row[];

  const active = TABS.find((tab) => tab.key === (sp.statut ?? "")) ?? TABS[0];
  const countFor = (statuses: readonly string[] | null) =>
    statuses === null ? all.length : all.filter((r) => statuses.includes(r.status)).length;
  const rows =
    active.statuses === null
      ? all
      : all.filter((r) => (active.statuses as readonly string[]).includes(r.status));

  // A draft saved before the price was typed stores 0: that is « non
  // renseigné », not « 0 TND », and not « Sur demande » either.
  const priceOf = (l: Row) =>
    l.price_on_request
      ? t("priceOnRequest")
      : !(Number(l.price) > 0)
        ? t("priceNotGiven")
        : t(asDealType(l.deal_type) === "rent" ? "pricePerMonth" : "price", {
            amount: formatTND(Number(l.price), locale),
          });

  const date = (v: string | null) => (v ? formatDate(v, locale, "medium") : "—");

  /** Day and month — the expiry date is never more than a few days away. */
  const shortDate = (v: string | null) => (v ? formatDate(v, locale, "dayMonth") : "");

  const categoryOf = (l: Row) =>
    categoryLabel(Array.isArray(l.category) ? l.category[0] : l.category, locale) || "—";

  /**
   * The wizard saves an untitled draft as « Brouillon » and checks for that
   * exact word when it reopens it, so the stored value stays French; the
   * seller sees it in their own language.
   */
  const titleOf = (l: Row) => (l.title === UNTITLED_DRAFT ? tAccount("untitledDraft") : l.title);

  /** Days left before a published annonce expires — the only date that is urgent. */
  const daysLeft = (l: Row) => {
    if (l.status !== "published" || !l.expires_at) return null;
    return Math.ceil((new Date(l.expires_at).getTime() - now) / 86_400_000);
  };

  /**
   * An annonce the seller took down while the days they had paid for were
   * still running. Those days are not forfeited: it goes back online for free
   * and without a second trip through the queue. Past that point renewing is
   * a new publication, which is what RENEWABLE and /renew cover.
   */
  const withinPaidWindow = (l: Row) =>
    l.status !== "expired" && !!l.expires_at && new Date(l.expires_at).getTime() > now;

  /**
   * The one action a row implies. Every branch points at a route that exists:
   * resuming a draft relies on /annonces/nouvelle loading the seller's own
   * draft, which is what it already does.
   */
  /**
   * The chip a row shows. A `pending_payment` annonce whose receipt is already
   * under review says so, instead of « À payer ».
   */
  function statusOf(l: Row) {
    // Held for someone who has not signed yet: still online, but the seller
    // should see at a glance which ones are spoken for.
    if (l.status === "published" && l.availability === "reserved") {
      return { label: t("status.reserved"), tone: "mazed-tone-warn", hint: undefined };
    }
    if (l.status === "pending_payment" && reviewFor.has(l.id)) {
      return {
        label: t("receiptInReview"),
        tone: "mazed-tone-warn",
        hint: t("receiptInReviewHint"),
      };
    }
    // Taken down by the console (0190): not « Retirée » like one the seller
    // withdrew — « Remettre en ligne » would be refused — so the card says
    // who took it down, and why when the moderator said.
    if (l.status === "archived" && l.taken_down_at) {
      return {
        label: t("status.takenDown"),
        tone: "mazed-tone-bad",
        hint: l.taken_down_reason
          ? t("statusHint.takenDownReason", { reason: l.taken_down_reason })
          : t("statusHint.takenDown"),
      };
    }
    const known = STATUS[l.status];
    if (!known) return { label: l.status, tone: "bg-surface-2 text-muted", hint: undefined };
    return {
      label: t(`status.${l.status}`),
      tone: known.tone,
      hint: known.hint ? t(`statusHint.${l.status}`) : undefined,
    };
  }

  function Action({ l, block = false }: { l: Row; block?: boolean }) {
    const cls = block
      ? "mazed-btn-luxe tap-target mt-3 flex h-11 w-full items-center justify-center gap-1.5 rounded-full px-4 text-[13px]"
      : "mazed-btn-luxe tap-target inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[12px]";

    // Receipt with an admin: the action is to look at it, not to pay again.
    if (l.status === "pending_payment" && reviewFor.has(l.id)) {
      return (
        <Link href={`/payment/checkout?payment=${reviewFor.get(l.id)}` as never} className={cls}>
          <CreditCard className="size-3.5" /> {t("viewReceipt")}
        </Link>
      );
    }
    if (l.status === "pending_payment" && payFor.has(l.id)) {
      return (
        <Link href={`/payment/checkout?payment=${payFor.get(l.id)}` as never} className={cls}>
          <CreditCard className="size-3.5" /> {t("pay")}
        </Link>
      );
    }
    // Refused or cancelled payment: the annonce is still waiting and there was
    // no way back to a payment at all.
    if (l.status === "pending_payment") {
      return <PaySubmitButton listingId={l.id} block={block} />;
    }
    // A draft: carry on with it, or throw it away.
    if (l.status === "draft") {
      return (
        <>
          <Link href={`/annonces/nouvelle?draft=${l.id}` as never} className={cls}>
            <PencilLine className="size-3.5" /> {t("resume")}
          </Link>
          <DeleteDraftButton listingId={l.id} block={block} />
        </>
      );
    }
    // « À corriger » has to reopen THAT annonce. It used to fall through to
    // « Voir », which 404s for anything unpublished.
    if (l.status === "rejected") {
      return (
        <Link href={`/annonces/nouvelle?draft=${l.id}` as never} className={cls}>
          <PencilLine className="size-3.5" /> {t("fix")}
        </Link>
      );
    }
    if (RENEWABLE.includes(l.status)) {
      // Taken down by the console: « Remettre en ligne » and « Renouveler »
      // are refused while it stands (0190). The way back is to write to us.
      if (l.taken_down_at) {
        return (
          <Link
            href={"/contact" as never}
            className={
              block
                ? "mazed-btn-quiet tap-target mt-3 flex h-11 w-full items-center justify-center gap-1.5 rounded-full px-4 text-[13px]"
                : "inline-flex items-center gap-1 text-[12.5px] font-bold text-foreground underline underline-offset-4 hover:text-muted"
            }
          >
            <MessageCircle className="size-3.5" /> {t("contactUs")}
          </Link>
        );
      }
      if (withinPaidWindow(l)) {
        return <ListingStatusActions listingId={l.id} actions={["relist"]} block={block} primary />;
      }
      return (
        <RenewButton
          listingId={l.id}
          free={freePlacesLeft > 0}
          usesCredit={creditsLeft > 0}
        />
      );
    }
    return (
      <>
        <Link
          href={`/annonces/${l.id}` as never}
          className={
            block
              ? "mazed-btn-quiet tap-target mt-3 flex h-11 w-full items-center justify-center gap-1.5 rounded-full px-4 text-[13px]"
              : "inline-flex items-center gap-1 text-[12.5px] font-bold text-foreground underline underline-offset-4 hover:text-muted"
          }
        >
          {t("view")} <ArrowRight className="size-3.5 rtl:-scale-x-100" />
        </Link>
        {/* A seller shares what is online from the list itself (the owner, 2026-10-28). */}
        {l.status === "published" && (
          <ShareButton
            variant="text"
            href={`/${locale}/annonces/${l.id}`}
            title={l.title}
            className={block ? "mt-2 flex justify-center" : "ms-3 inline-flex"}
          />
        )}
        {/* Edit what is online (0172), or what is still waiting for an admin —
            a zero too many is often noticed right after sending. Not while
            editing is switched off in the console. */}
        {settings.feature_listing_edit && isEditable(l) && (
          <Link
            href={`/annonces/nouvelle?edit=${l.id}` as never}
            className={
              block
                ? "mazed-btn-quiet tap-target mt-2 flex h-11 w-full items-center justify-center gap-1.5 rounded-full px-4 text-[13px]"
                : "ms-3 inline-flex items-center gap-1 text-[12.5px] font-bold text-foreground hover:underline"
            }
          >
            <PencilLine className="size-3.5" /> {l.pending_edit_at ? t("editPending") : t("edit")}
          </Link>
        )}
        {/* « Promouvoir » and « Mettre en avant » both sound like "more people
            see it", so each says where, under its name — in the link itself,
            so it reads the same on a phone, with no tooltip to hover. */}
        {/* On Mazed Immo's Facebook page, Instagram and the groups (0170). */}
        {settings.social_enabled && l.status === "published" && (
          <Link
            href={`/account/listings/${l.id}/promote` as never}
            className={
              block
                ? "mazed-band-warm mt-2 flex w-full flex-col items-center rounded-2xl px-3 py-2.5 text-center text-foreground ring-1 ring-border"
                : "group mt-1.5 flex flex-col items-end text-end text-foreground"
            }
          >
            <span className={cn("inline-flex items-center gap-1.5 text-[12.5px] font-bold", !block && "group-hover:underline")}>
              <Megaphone className="size-3.5" /> {t("promote")}
            </span>
            <span className="max-w-[32ch] text-[11px] leading-snug text-muted">{t("promoteHint")}</span>
          </Link>
        )}
        {/* Paid placements: home page, top of search, the home banner (0156),
            while the console sells them. */}
        {settings.feature_promos && l.status === "published" && (
          <Link
            href={`/account/listings/${l.id}/mise-en-avant` as never}
            className={
              block
                ? "mt-2 flex w-full flex-col items-center rounded-2xl px-3 py-2.5 text-center text-foreground ring-1 ring-border hover:ring-foreground/30"
                : "group mt-1.5 flex flex-col items-end text-end text-foreground"
            }
          >
            <span className={cn("inline-flex items-center gap-1.5 text-[12.5px] font-bold", !block && "group-hover:underline")}>
              <Sparkles className="size-3.5" /> {t("boost")}
            </span>
            <span className="max-w-[32ch] text-[11px] leading-snug text-muted">{t("boostHint")}</span>
          </Link>
        )}
        {/* Say it is sold or let, hold it for someone, or take it down. */}
        {l.status === "published" && (
          <ListingStatusActions
            listingId={l.id}
            actions={[
              asDealType(l.deal_type) === "rent" ? "mark_rented" : "mark_sold",
              l.availability === "reserved" ? "unreserve" : "reserve",
              "withdraw",
            ]}
            block={block}
          />
        )}
      </>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 lg:max-w-6xl lg:px-8 lg:py-10 xl:max-w-7xl">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="mazed-h2 text-[26px] text-foreground lg:text-[32px]">{t("title")}</h1>
          <p className="mt-1 text-[13px] text-muted lg:text-[14px]">
            {all.length === 0
              ? t("subtitleEmpty")
              : t("subtitleCount", { count: all.length })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {allowance.kind === "plan" ? (
            <span className="inline-flex h-11 items-center gap-1.5 rounded-full bg-surface-2 px-3.5 text-[12.5px] font-bold text-foreground">
              {t("planPlaces", { used: allowance.used, limit: allowance.limit, plan: allowance.planName })}
            </span>
          ) : (
            freeLimit > 0 && (
              <span className="inline-flex h-11 items-center gap-1.5 rounded-full bg-surface-2 px-3.5 text-[12.5px] font-bold text-foreground">
                {t("freePlaces", { used: Math.min(allowance.used, freeLimit), limit: freeLimit })}
              </span>
            )
          )}
          {creditsLeft > 0 && (
            <span className="inline-flex h-11 items-center gap-1.5 rounded-full bg-surface-2 px-3.5 text-[12.5px] font-bold text-foreground">
              <Ticket className="size-4" />
              {t("creditsLeft", { count: creditsLeft })}
            </span>
          )}
          <Link href={"/annonces/nouvelle" as never} className="mazed-btn-luxe tap-target h-11 gap-1.5 rounded-full px-5 text-[13px]">
            <Plus className="size-4" /> {t("publish")}
          </Link>
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────────
          The count and the filter are one control. On a phone they scroll
          sideways instead of wrapping into three ragged rows. */}
      {all.length > 0 && (
        <nav className="-mx-4 mt-5 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:overflow-visible lg:px-0">
          <div className="mazed-segment min-w-max lg:min-w-0">
            {TABS.map((tab) => {
              const n = countFor(tab.statuses);
              const on = tab.key === active.key;
              // An empty tab is noise — unless you are standing in it, in which
              // case removing it would strand you.
              if (n === 0 && !on && tab.key !== "") return null;
              return (
                <Link
                  key={tab.key || "all"}
                  href={(tab.key ? `/account/listings?statut=${tab.key}` : "/account/listings") as never}
                  aria-current={on ? "page" : undefined}
                  className="gap-1.5 whitespace-nowrap"
                >
                  {t(`tabs.${tab.label}`)}
                  <span className={`mazed-tabular text-[12.5px] font-extrabold ${on ? "text-foreground" : tab.tone}`}>
                    {n}
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>
      )}

      {/* ── PHONE · one card per annonce ───────────────────────────────── */}
      <div className="mt-4 space-y-3 lg:hidden">
        {rows.map((l) => {
          const st = statusOf(l);
          const cover = coverPhoto(l.photos);
          const left = daysLeft(l);
          return (
            <article key={l.id} className="rounded-[var(--radius-2xl)] bg-surface p-3 ring-1 ring-border">
              <div className="flex gap-3">
                <Link
                  href={`/annonces/${l.id}` as never}
                  aria-label={l.title || tAccount("untitledDraft")}
                  className="mazed-photo-frame aspect-[4/3] w-[108px] shrink-0"
                >
                  {cover ? (
                    <ListingImage path={cover.storage_path} alt="" sizes="108px" fit="cover" />
                  ) : (
                    <span className="grid size-full place-items-center text-muted"><ImageOff className="size-5" /></span>
                  )}
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-[0.12em] ${st.tone}`}>
                      {st.label}
                    </span>
                    <span className="truncate text-[11px] text-muted">{categoryOf(l)}</span>
                  </div>
                  <p className="mazed-tabular mt-1.5 text-[16px] font-extrabold leading-none text-foreground">{priceOf(l)}</p>
                  <Link href={`/annonces/${l.id}` as never} className="mt-1.5 block truncate text-[13.5px] font-semibold text-foreground">
                    {titleOf(l)}
                  </Link>
                </div>
              </div>

              {l.rejection_reason ? (
                <p className="mt-2.5 flex items-start gap-1.5 rounded-lg bg-[var(--accent-faint)] px-2.5 py-1.5 text-[11.5px] leading-relaxed text-[var(--accent-deep)]">
                  <AlertTriangle className="mt-px size-3.5 shrink-0" />
                  <span>
                    {/* Why it is under « À corriger »: our team sent it back. */}
                    {l.status === "rejected" && <span className="font-bold">{t("rejectedPrefix")} </span>}
                    {l.rejection_reason}
                  </span>
                </p>
              ) : st.hint ? (
                <p className="mt-2.5 text-[11.5px] text-muted">{st.hint}</p>
              ) : null}

              {left !== null && (
                <p className={`mt-2 inline-flex items-center gap-1 text-[11.5px] ${left <= 3 ? "font-bold text-amber-600" : "text-muted"}`}>
                  <Clock className="size-3" />
                  {left <= 0 ? t("expiresToday") : t("daysLeft", { days: left })}
                  {/* Renewal is refused while an annonce is published — it
                      would take a paid, live annonce off the catalogue while
                      the fee is verified. So the date is the useful fact, not
                      a « Renouveler » button that cannot be there yet. */}
                  {left <= 3 && (
                    <span className="font-semibold">{t("renewableOn", { date: shortDate(l.expires_at) })}</span>
                  )}
                </p>
              )}

              <Action l={l} block />
            </article>
          );
        })}
      </div>

      {/* ── DESKTOP · a management table ────────────────────────────────────
          At this width the seller compares rows — status, price, dates — so
          they get columns and aligned numbers rather than a ribbon of cards
          with an ocean of empty space beside it. */}
      <div className="mt-6 hidden overflow-hidden rounded-[var(--radius-2xl)] bg-surface ring-1 ring-border lg:block">
        {/* A fixed layout: the columns share the width, a long title truncates
            in its cell and the actions keep their column. Laid out from the
            content, the title and the hints pushed the table wider than the
            page and the whole « Action » column was cut off (overflow-hidden). */}
        <div className="overflow-x-auto">
        <table className="w-full table-fixed text-[13px]">
          <colgroup>
            <col className="w-[34%]" />
            <col className="w-[18%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[18%]" />
          </colgroup>
          <thead className="bg-paper-warm text-[10px] uppercase tracking-[0.14em] text-muted">
            <tr>
              <th className="px-5 py-3.5 text-start font-extrabold">{t("columns.listing")}</th>
              <th className="px-3 py-3.5 text-start font-extrabold">{t("columns.status")}</th>
              <th className="px-3 py-3.5 text-end font-extrabold">{t("columns.price")}</th>
              <th className="px-3 py-3.5 text-start font-extrabold">{t("columns.published")}</th>
              <th className="px-3 py-3.5 text-start font-extrabold">{t("columns.expires")}</th>
              <th className="px-4 py-3.5 text-end font-extrabold">{t("columns.action")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((l) => {
              const st = statusOf(l);
              const cover = coverPhoto(l.photos);
              const left = daysLeft(l);
              return (
                <tr key={l.id} className="align-middle transition hover:bg-surface-2/50">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3.5">
                      <Link
                        href={`/annonces/${l.id}` as never}
                        aria-label={l.title || tAccount("untitledDraft")}
                        className="mazed-photo-frame aspect-[4/3] w-[76px] shrink-0"
                      >
                        {cover ? (
                          <ListingImage path={cover.storage_path} alt="" sizes="76px" fit="cover" />
                        ) : (
                          <span className="grid size-full place-items-center text-muted"><ImageOff className="size-4" /></span>
                        )}
                      </Link>
                      <div className="min-w-0">
                        <Link
                          href={`/annonces/${l.id}` as never}
                          className="block truncate text-[14px] font-bold text-foreground hover:underline"
                        >
                          {titleOf(l)}
                        </Link>
                        <div className="truncate text-[11.5px] text-muted">{categoryOf(l)}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3.5">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-[0.12em] ${st.tone}`}>
                      {st.label}
                    </span>
                    {l.rejection_reason ? (
                      <div className="mt-1 max-w-[26ch] truncate text-[11px] text-[var(--accent-deep)]" title={l.rejection_reason}>
                        {l.status === "rejected" && <span className="font-bold">{t("rejectedPrefix")} </span>}
                        {l.rejection_reason}
                      </div>
                    ) : st.hint ? (
                      <div className="mt-1 max-w-[26ch] text-[11px] leading-snug text-muted">{st.hint}</div>
                    ) : null}
                  </td>
                  <td className="mazed-tabular whitespace-nowrap px-3 py-3.5 text-end font-extrabold text-foreground">
                    {priceOf(l)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3.5 text-[12.5px] text-muted">{date(l.published_at)}</td>
                  <td className="whitespace-nowrap px-3 py-3.5 text-[12.5px]">
                    {left === null ? (
                      <span className="text-muted">{l.status === "published" ? "—" : date(l.expires_at)}</span>
                    ) : (
                      <span className={left <= 3 ? "font-bold text-amber-600" : "text-muted"}>
                        {date(l.expires_at)}
                        <span className="block text-[11px]">
                          {left <= 0 ? t("today") : t("inDays", { days: left })}
                        </span>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-end"><Action l={l} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>

      {/* ── Empty ──────────────────────────────────────────────────────────
          Distinguishes "you have nothing" from "this tab has nothing" — two
          different problems with two different ways out. */}
      {rows.length === 0 && (
        <div className="mazed-band-warm mt-5 rounded-[var(--radius-3xl)] p-8 text-center lg:p-14">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-surface text-foreground shadow-[var(--shadow-card)]">
            <Inbox className="size-6" />
          </span>
          {all.length === 0 ? (
            <>
              <p className="mt-4 text-[15px] font-bold text-foreground">{t("emptyTitle")}</p>
              <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-muted">
                {t("emptyBody")}
              </p>
              <Link href={"/annonces/nouvelle" as never} className="mazed-btn-luxe tap-target mt-6 inline-flex h-12 items-center gap-2 rounded-full px-6 text-[14px]">
                <Plus className="size-4" /> {t("publishListing")}
              </Link>
            </>
          ) : (
            <>
              <p className="mt-4 text-[15px] font-bold text-foreground">
                {t("emptyTabTitle", { tab: t(`tabs.${active.label}`) })}
              </p>
              <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-muted">
                {t("emptyTabBody")}
              </p>
              <Link
                href={"/account/listings" as never}
                className="mt-5 inline-flex items-center gap-1 text-[13px] font-bold text-foreground underline underline-offset-4"
              >
                {t("seeAll")} <ArrowRight className="size-3.5 rtl:-scale-x-100" />
              </Link>
            </>
          )}
        </div>
      )}
    </main>
  );
}
