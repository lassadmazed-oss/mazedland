import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Ltr } from "@/components/ui/Ltr";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { formatDate, formatTND } from "@/lib/utils";
import { agreedAmount, percentBelow, shownStatus, type OfferSide } from "@/lib/offers";
import type { OfferView } from "@/lib/offers-server";
import { BadgeCheck, Clock, HandCoins, Home, MessageSquare, Phone, Wallet } from "lucide-react";
import { OfferActions } from "./OfferActions";

const TONE: Record<string, string> = {
  pending: "mazed-tone-warn",
  countered: "mazed-tone-warn",
  accepted: "mazed-tone-ok",
  declined: "mazed-tone-bad",
  withdrawn: "bg-surface-2 text-muted",
  expired: "bg-surface-2 text-muted",
};

/**
 * One price offer (0211), as its seller's side or its buyer sees it: the
 * annonce, where it stands, the figures — the asking price, the offer, the
 * seller's price, the one agreed — and who to call: the buyer for the
 * seller's side always, the seller for the buyer once they agreed.
 */
export async function OfferCard({ offer, side, locale, highlight = false }: { offer: OfferView; side: OfferSide; locale: string; highlight?: boolean }) {
  const t = await getTranslations("offers.card");
  const tStatus = await getTranslations("offers.status");
  const tFin = await getTranslations("offers.request.financing");
  const tCommon = await getTranslations("common");
  const status = shownStatus(offer);
  const agreed = agreedAmount({ ...offer, status });
  const tnd = (n: number) => `${formatTND(n, locale)} ${tCommon("tnd")}`;
  const open = status === "pending" || status === "countered";

  return (
    <article id={`o-${offer.id}`} className={`scroll-mt-24 rounded-[var(--radius-2xl)] bg-surface p-4 ${highlight ? "ring-2 ring-foreground" : "ring-1 ring-border"}`}>
      <div className="flex items-start gap-3">
        <span className="grid aspect-[4/3] w-[76px] shrink-0 place-items-center overflow-hidden rounded-[var(--radius-lg)] bg-surface-2 ring-1 ring-border">
          {offer.listing?.photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- a small thumbnail
            <img src={propertyPhotoUrl(offer.listing.photo, { transform: { width: 120, quality: 70 } })} alt="" className="size-full object-cover" />
          ) : (
            <Home className="size-5 text-muted" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          {offer.listing ? (
            <Link href={`/annonces/${offer.listing.id}` as never} className="line-clamp-1 text-[13.5px] font-bold text-foreground hover:underline" dir="auto">
              {offer.listing.title}
            </Link>
          ) : (
            <p className="text-[13.5px] font-bold text-muted">{t("listingGone")}</p>
          )}
          <p className="mt-0.5 text-[11.5px] text-muted">{t("sent", { date: formatDate(offer.created_at, locale, "dayMonth") })}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${TONE[status] ?? ""}`}>{tStatus(status)}</span>
      </div>

      <dl className="mt-3 divide-y divide-border rounded-xl bg-surface-2/60 px-3 text-[12.5px] ring-1 ring-border">
        <div className="flex items-center justify-between gap-3 py-2">
          <dt className="text-muted">{t("asking")}</dt>
          <dd className="mazed-tabular text-end text-foreground">{tnd(offer.asking_price)}</dd>
        </div>
        <div className="flex items-center justify-between gap-3 py-2">
          <dt className="text-muted">{t(side === "buyer" ? "yourOffer" : "offer")}</dt>
          <dd className="text-end font-bold text-foreground">
            <span className="mazed-tabular">{tnd(offer.amount)}</span>{" "}
            <span dir="ltr" className="text-[11px] font-semibold text-muted">−{percentBelow(offer.amount, offer.asking_price)} %</span>
          </dd>
        </div>
        {offer.counter_amount != null && (
          <div className="flex items-center justify-between gap-3 py-2">
            <dt className="text-muted">{t(side === "seller" ? "yourCounter" : "counter")}</dt>
            <dd className="mazed-tabular text-end font-bold text-foreground">{tnd(offer.counter_amount)}</dd>
          </div>
        )}
        {agreed != null && (
          <div className="flex items-center justify-between gap-3 py-2">
            <dt className="flex items-center gap-1.5 font-bold text-[var(--tone-ok)]"><BadgeCheck className="size-4" /> {t("agreed")}</dt>
            <dd className="mazed-tabular text-end text-[14px] font-extrabold text-foreground">{tnd(agreed)}</dd>
          </div>
        )}
      </dl>

      <div className="mt-3 space-y-1.5 text-[12.5px]">
        {offer.financing && (
          <p className="flex items-center gap-2 text-foreground">
            <Wallet className="size-4 shrink-0 text-muted" /> {tFin(offer.financing)}
          </p>
        )}
        {side === "seller" && (
          <p className="flex items-center gap-2 text-foreground">
            <Phone className="size-4 shrink-0 text-muted" />
            <span dir="auto">{offer.buyer_name}</span>
            {/* No number once the buyer deleted their account: the offer stays, the person does not. */}
            {offer.buyer_phone && (
              <>
                {" "}·{" "}
                <a href={`tel:${offer.buyer_phone}`} className="font-bold hover:underline">
                  <Ltr>{offer.buyer_phone}</Ltr>
                </a>
              </>
            )}
          </p>
        )}
        {side === "buyer" && status === "accepted" && offer.listing?.sellerPhone && (
          <p className="mazed-tone-ok flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 font-bold">
            <Phone className="size-4 shrink-0" />
            {t("callSeller")}
            {offer.listing.sellerName && <span dir="auto">{offer.listing.sellerName}</span>}
            <a href={`tel:${offer.listing.sellerPhone}`} className="underline underline-offset-4">
              <Ltr>{offer.listing.sellerPhone}</Ltr>
            </a>
          </p>
        )}
        {offer.message && (
          <p className="flex items-start gap-2 text-muted">
            <MessageSquare className="mt-0.5 size-4 shrink-0" />
            <span className="whitespace-pre-line" dir="auto">{offer.message}</span>
          </p>
        )}
        {offer.seller_note && (
          <p className="mazed-band-warm rounded-xl px-3 py-2 text-foreground ring-1 ring-border" dir="auto">
            <span className="font-bold">{t(side === "seller" ? "yourNote" : "sellerNote")} </span>
            {offer.seller_note}
          </p>
        )}
        {open && (
          <p className="flex items-center gap-2 text-muted">
            <Clock className="size-4 shrink-0" />
            {t(
              (status === "pending") === (side === "seller") ? "answerBefore" : "waitingUntil",
              { date: formatDate(offer.expires_at, locale, "dayMonth") },
            )}
          </p>
        )}
        {side === "buyer" && status === "accepted" && <p className="text-[11.5px] text-muted">{t("nextSteps")}</p>}
      </div>

      <div className="mt-3">
        {open ? (
          <OfferActions
            offerId={offer.id}
            side={side}
            status={status}
            amount={offer.amount}
            counter={offer.counter_amount}
            asking={offer.asking_price}
          />
        ) : (
          // Turned down or run out: the annonce is one tap away for another try.
          side === "buyer" && status !== "accepted" && offer.listing?.online && (
            <Link href={`/annonces/${offer.listing.id}#offre` as never} className="mazed-btn-quiet tap-target inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-bold">
              <HandCoins className="size-3.5" /> {t("again")}
            </Link>
          )
        )}
      </div>
    </article>
  );
}
