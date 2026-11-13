"use client";

import { useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, MessageCircleQuestion, X } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { useApiError } from "@/lib/useApiError";
import { useSetting } from "@/components/settings/SettingsProvider";
import { VISIT_NAME_MAX } from "@/lib/visits";
import { QUESTION_MESSAGE_MAX } from "@/lib/price-questions";
import { formatTND } from "@/lib/utils";
import { trackEvent } from "@/lib/analytics/events";

/** The buyer's question on this annonce that waits, or the price the seller answered. */
export type OpenQuestion = { status: "open" } | { status: "answered"; price: number };

/**
 * « Demander le prix » (0222), on an annonce « Prix sur demande »: the seller
 * chose to be asked, so asking is one tap and a word — the message opens on a
 * polite default naming the annonce, the name and number come from the
 * profile. Signed out, it leads to sign-in and back. A question already sent
 * says where it stands; an answered one shows the price the seller gave.
 * Switched off, nothing: questions already asked stay in « Demandes de prix ».
 */
export function PriceQuestion({
  listingId,
  reference,
  rent,
  loggedIn,
  defaultName,
  defaultPhone,
  open,
}: {
  listingId: string;
  reference: string | null;
  rent: boolean;
  loggedIn: boolean;
  defaultName: string;
  defaultPhone: string;
  open: OpenQuestion | null;
}) {
  const t = useTranslations("priceQuestions.request");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { toast } = useToast();
  const apiError = useApiError();
  const ids = useId();
  const on = useSetting("feature_price_questions");
  const [form, setForm] = useState(false);
  const [name, setName] = useState(defaultName);
  const [phone, setPhone] = useState(defaultPhone);
  // The reference is left-to-right inside an Arabic sentence: isolated, « MZ-01727 »
  // stays one piece instead of « MZ- » at a line's end and « 01727؟ » on the next.
  const [message, setMessage] = useState(() => t("defaultMessage", { ref: reference ? `⁦${reference}⁩` : "" }));
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<OpenQuestion | null>(open);

  const button =
    "tap-target mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border text-[13.5px] font-bold text-foreground transition hover:bg-surface-2";

  if (sent?.status === "answered") {
    return (
      <div className="mt-3 rounded-xl bg-surface-2 px-3 py-2.5 text-[12.5px] leading-snug text-foreground ring-1 ring-border">
        <p className="flex items-center gap-1.5 font-bold">
          <MessageCircleQuestion className="size-4 text-gold" /> {t("answeredTitle")}
        </p>
        <p className="mt-1 text-[18px] font-extrabold text-foreground">
          <span dir="ltr" className="mazed-tabular">{formatTND(sent.price, locale)}</span> {tc("tnd")}
          {rent && <span className="text-[13px] font-bold text-muted"> {t("perMonth")}</span>}
        </p>
      </div>
    );
  }

  if (sent) {
    return (
      <div className="mt-3 rounded-xl bg-surface-2 px-3 py-2.5 text-[12.5px] leading-snug text-foreground ring-1 ring-border">
        <p className="flex items-center gap-1.5 font-bold">
          <MessageCircleQuestion className="size-4 text-gold" /> {t("sentTitle")}
        </p>
        <p className="mt-0.5 text-muted">{t("sentBody")}</p>
        <Link href="/account/prix?tab=sent" className="mt-1 inline-block font-bold text-gold hover:underline">
          {t("follow")}
        </Link>
      </div>
    );
  }

  if (!on) return null;

  if (!loggedIn) {
    return (
      <Link href={`/login?next=${encodeURIComponent(`/${locale}/annonces/${listingId}`)}` as never} className={button}>
        <MessageCircleQuestion className="size-4" /> {t("cta")}
      </Link>
    );
  }

  if (!form) {
    return (
      <button
        type="button"
        onClick={() => {
          trackEvent("price_question_open", {}, { listing: listingId });
          setForm(true);
        }}
        className={button}
      >
        <MessageCircleQuestion className="size-4" /> {t("cta")}
      </button>
    );
  }

  const label = "text-[11.5px] font-bold text-foreground";
  const field = "h-10 w-full rounded-xl border border-border bg-surface px-3 text-[13px] text-foreground focus:border-gold-soft focus:outline-none";

  async function send() {
    setBusy(true);
    try {
      const res = await fetch("/api/prix", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listingId, name, phone, message }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(apiError(j, t("failed")), res.status === 409 || res.status === 429 ? "warning" : "error");
        if (res.status === 409) setSent({ status: "open" });
        return;
      }
      toast(t("sentToast"), "success");
      // GA: which annonce — not the name, the number or the message.
      trackEvent("price_question", {}, { listing: listingId });
      setSent({ status: "open" });
    } catch {
      toast(t("failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      id="prix"
      className="mt-3 space-y-3 rounded-xl bg-surface-2 p-3 ring-1 ring-border"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-extrabold text-foreground">{t("title")}</p>
        <button
          type="button"
          onClick={() => setForm(false)}
          aria-label={t("close")}
          className="tap-target -me-2 inline-flex items-center justify-center text-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      <p className="text-[11.5px] leading-snug text-muted">{t("hint")}</p>

      <div>
        <label htmlFor={`${ids}-message`} className={label}>{t("message")}</label>
        <textarea
          id={`${ids}-message`}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={QUESTION_MESSAGE_MAX}
          rows={2}
          className="mt-1.5 w-full rounded-xl border border-border bg-surface px-3 py-2 text-[13px] text-foreground focus:border-gold-soft focus:outline-none"
          dir="auto"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={VISIT_NAME_MAX} autoComplete="name" placeholder={t("name")} aria-label={t("name")} className={field} dir="auto" />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} required type="tel" inputMode="tel" autoComplete="tel" placeholder={t("phone")} aria-label={t("phone")} className={field} dir="ltr" />
      </div>

      <p className="text-[11px] leading-snug text-muted">{t("shared")}</p>
      <button type="submit" disabled={busy} className="mazed-btn-luxe tap-target flex h-11 w-full items-center justify-center gap-2 text-[13.5px] disabled:opacity-60">
        {busy && <Loader2 className="size-4 animate-spin" />} {t("send")}
      </button>
    </form>
  );
}
