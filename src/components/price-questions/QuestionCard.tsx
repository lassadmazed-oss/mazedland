import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Ltr } from "@/components/ui/Ltr";
import { annoncePhotoUrl } from "@/lib/imageUrl";
import { formatDate, formatTND } from "@/lib/utils";
import { asDealType } from "@/lib/listings/deal";
import type { QuestionView } from "@/lib/price-questions-server";
import { BadgeCheck, Home, MessageCircle, MessageSquare, Phone } from "lucide-react";
import { QuestionActions } from "./QuestionActions";

const TONE: Record<string, string> = {
  open: "mazed-tone-warn",
  answered: "mazed-tone-ok",
  done: "bg-surface-2 text-muted",
};

/**
 * One price question (0222), as its seller's side or its buyer sees it: the
 * annonce, where it stands, the buyer's word, who to call — the buyer, for
 * the seller's side — and the price, once the seller gave it.
 */
export async function QuestionCard({
  question,
  side,
  locale,
  highlight = false,
}: {
  question: QuestionView;
  side: "seller" | "buyer";
  locale: string;
  highlight?: boolean;
}) {
  const t = await getTranslations("priceQuestions.card");
  const tStatus = await getTranslations("priceQuestions.status");
  const tCommon = await getTranslations("common");
  const rent = asDealType(question.listing?.deal_type ?? null) === "rent";
  const price = question.answer_price == null ? null : Number(question.answer_price);
  const digits = question.buyer_phone?.replace(/\D/g, "") ?? "";

  return (
    <article id={`q-${question.id}`} className={`scroll-mt-24 rounded-[var(--radius-2xl)] bg-surface p-4 ${highlight ? "ring-2 ring-foreground" : "ring-1 ring-border"}`}>
      <div className="flex items-start gap-3">
        <span className="grid aspect-[4/3] w-[76px] shrink-0 place-items-center overflow-hidden rounded-[var(--radius-lg)] bg-surface-2 ring-1 ring-border">
          {question.listing?.photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- a small thumbnail
            <img src={annoncePhotoUrl(question.listing.photo, 120, 70)} alt="" className="size-full object-cover" />
          ) : (
            <Home className="size-5 text-muted" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          {question.listing ? (
            <Link href={`/annonces/${question.listing.id}` as never} className="line-clamp-1 text-[13.5px] font-bold text-foreground hover:underline" dir="auto">
              {question.listing.title}
            </Link>
          ) : (
            <p className="text-[13.5px] font-bold text-muted">{t("listingGone")}</p>
          )}
          <p className="mt-0.5 text-[11.5px] text-muted">
            {question.listing?.reference && <Ltr>{question.listing.reference}</Ltr>}
            {question.listing?.reference && " · "}
            {t("asked", { date: formatDate(question.created_at, locale, "dayMonth") })}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${TONE[question.status] ?? ""}`}>{tStatus(question.status)}</span>
      </div>

      <div className="mt-3 space-y-1.5 text-[12.5px]">
        {side === "seller" && (
          <p className="flex flex-wrap items-center gap-2 text-foreground">
            <Phone className="size-4 shrink-0 text-muted" />
            <span dir="auto">{question.buyer_name}</span>
            {question.buyer_phone && (
              <>
                ·
                <a href={`tel:${question.buyer_phone}`} className="font-bold hover:underline">
                  <Ltr>{question.buyer_phone}</Ltr>
                </a>
                {digits.length >= 8 && (
                  <a href={`https://wa.me/${digits}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-bold text-muted hover:text-foreground">
                    <MessageCircle className="size-3.5" /> {t("whatsapp")}
                  </a>
                )}
              </>
            )}
          </p>
        )}
        {question.message && (
          <p className="flex items-start gap-2 text-muted">
            <MessageSquare className="mt-0.5 size-4 shrink-0" />
            <span className="whitespace-pre-line" dir="auto">{question.message}</span>
          </p>
        )}
        {price != null && (
          <p className="mazed-tone-ok flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 font-bold">
            <BadgeCheck className="size-4 shrink-0" />
            {t(side === "seller" ? "yourAnswer" : "answer")}
            <span>
              <span dir="ltr" className="mazed-tabular">{formatTND(price, locale)}</span> {tCommon("tnd")}
              {rent && ` ${t("perMonth")}`}
            </span>
          </p>
        )}
        {side === "buyer" && question.status === "open" && <p className="text-muted">{t("waitingSeller")}</p>}
        {side === "buyer" && question.status === "done" && <p className="text-muted">{t("doneBuyer")}</p>}
      </div>

      {side === "seller" && question.status === "open" && (
        <div className="mt-3">
          <QuestionActions questionId={question.id} rent={rent} />
        </div>
      )}
    </article>
  );
}
