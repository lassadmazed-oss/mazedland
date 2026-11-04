"use client";

import { useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, HandCoins, Loader2, Plus, X } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { useApiError } from "@/lib/useApiError";
import { useSetting } from "@/components/settings/SettingsProvider";
import { VISIT_NAME_MAX } from "@/lib/visits";
import {
  checkAmount,
  FINANCING,
  OFFER_MESSAGE_MAX,
  OFFER_PHRASES,
  offerChips,
  offerFloor,
  parseAmount,
  type Financing,
} from "@/lib/offers";
import { hasPhrase, togglePhrase } from "@/lib/phrases";
import { chipClass } from "@/lib/chips";
import { formatTND } from "@/lib/utils";
import { trackEvent } from "@/lib/analytics/events";

/** The buyer's offer on this annonce that is still open, or the one both sides agreed on. */
export type OpenOffer = { status: "pending" | "countered" | "accepted"; amount: number; counter: number | null };

/**
 * « Proposer un prix » (0211): an amount under the asking price, the buyer's
 * name and number, a word for the seller. Offered only where the console
 * allows it (a negotiable sale by default) — the page decides that. Signed
 * out, it leads to sign-in and back. With an offer open, it says where that
 * one stands instead; once the buyer has made the console's number of
 * offers, it says so.
 *
 * Nothing has to be typed: three amounts under the price are chips
 * (« Autre montant » keeps a box, never under the console's floor), the
 * financing is two chips, the name and number come from the profile, and
 * the message opens on a polite default with phrases to add.
 */
export function PriceOffer({
  listingId,
  price,
  loggedIn,
  defaultName,
  defaultPhone,
  open,
  left,
}: {
  listingId: string;
  price: number;
  loggedIn: boolean;
  defaultName: string;
  defaultPhone: string;
  open: OpenOffer | null;
  /** How many more offers this buyer may make on this annonce. */
  left: number;
}) {
  const t = useTranslations("offers.request");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const { toast } = useToast();
  const apiError = useApiError();
  const ids = useId();
  const on = useSetting("feature_offers");
  const minPercent = useSetting("offers_min_percent");
  const chipStep = useSetting("offers_chip_step");
  const chips = offerChips(price, { minPercent, chipStep });
  const [form, setForm] = useState(false);
  // A chip's amount, or « other » with the box below.
  const [pick, setPick] = useState<number | "other">(() => chips[1]?.amount ?? chips[0]?.amount ?? "other");
  const [typed, setTyped] = useState("");
  const [financing, setFinancing] = useState<Financing | null>(null);
  const [name, setName] = useState(defaultName);
  const [phone, setPhone] = useState(defaultPhone);
  const [message, setMessage] = useState(() => t("defaultMessage"));
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<OpenOffer | null>(open);

  if (!on) return null;
  const tnd = (n: number) => `${formatTND(n, locale)} ${tCommon("tnd")}`;
  const button = "tap-target mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border text-[13.5px] font-bold text-foreground transition hover:bg-surface-2";

  if (sent) {
    const title =
      sent.status === "accepted"
        ? t("acceptedTitle", { amount: tnd(sent.counter ?? sent.amount) })
        : sent.status === "countered" && sent.counter
          ? t("counteredTitle", { amount: tnd(sent.counter) })
          : t("sentTitle", { amount: tnd(sent.amount) });
    return (
      <div className="mt-3 rounded-xl bg-surface-2 px-3 py-2.5 text-[12.5px] leading-snug text-foreground ring-1 ring-border">
        <p className="flex items-center gap-1.5 font-bold">
          <HandCoins className="size-4 text-gold" /> {title}
        </p>
        <p className="mt-0.5 text-muted">{t(sent.status === "accepted" ? "acceptedBody" : sent.status === "countered" ? "counteredBody" : "sentBody")}</p>
        <Link href="/account/offres?tab=sent" className="mt-1 inline-block font-bold text-gold hover:underline">
          {t("follow")}
        </Link>
      </div>
    );
  }

  if (left <= 0) {
    return <p className="mt-3 text-center text-[12px] text-muted">{t("noneLeft")}</p>;
  }

  if (!loggedIn) {
    return (
      <Link href={`/login?next=${encodeURIComponent(`/${locale}/annonces/${listingId}`)}` as never} className={button}>
        <HandCoins className="size-4" /> {t("cta")}
      </Link>
    );
  }

  if (!form) {
    return (
      <button
        type="button"
        onClick={() => {
          trackEvent("offer_open", {}, { listing: listingId });
          setForm(true);
        }}
        className={button}
      >
        <HandCoins className="size-4" /> {t("cta")}
      </button>
    );
  }

  const floor = offerFloor(price, minPercent);
  const amount = pick === "other" ? parseAmount(typed) : pick;
  const check = amount ? checkAmount(amount, price, minPercent) : null;
  const label = "text-[11.5px] font-bold text-foreground";
  const field = "h-10 w-full rounded-xl border border-border bg-surface px-3 text-[13px] text-foreground focus:border-gold-soft focus:outline-none";

  async function send() {
    if (!amount || check !== "ok") return;
    setBusy(true);
    try {
      const res = await fetch("/api/offres", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listingId, amount, financing, name, phone, message }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(apiError(j, t("failed")), res.status === 409 || res.status === 429 ? "warning" : "error");
        return;
      }
      toast(t("sentToast"), "success");
      // GA: which annonce and how far under the price — not the amount, the name or the number.
      trackEvent("offer_send", { below: Math.round(((price - amount) / price) * 100) }, { listing: listingId });
      setSent({ status: "pending", amount, counter: null });
    } catch {
      toast(t("failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      id="offre"
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
      <p className="text-[11.5px] leading-snug text-muted">
        <span className="font-bold text-foreground">{t("asking", { amount: tnd(price) })}</span> · {t("hint")}
      </p>

      <div>
        <p id={`${ids}-amount`} className={label}>{t("amountLabel")}</p>
        <div role="radiogroup" aria-labelledby={`${ids}-amount`} className="mt-1.5 flex flex-wrap gap-2">
          {chips.map((c) => (
            <button
              key={c.amount}
              type="button"
              role="radio"
              aria-checked={pick === c.amount}
              onClick={() => setPick(c.amount)}
              className={chipClass(pick === c.amount)}
            >
              <span dir="ltr" className="mazed-tabular">{formatTND(c.amount, locale)}</span>
              <span dir="ltr" className="text-[11px] opacity-80">−{c.percent} %</span>
            </button>
          ))}
          <button type="button" role="radio" aria-checked={pick === "other"} onClick={() => setPick("other")} className={chipClass(pick === "other")}>
            {t("other")}
          </button>
        </div>
        {pick === "other" && (
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            inputMode="numeric"
            autoFocus
            placeholder={t("otherPlaceholder", { amount: formatTND(floor, locale) })}
            aria-label={t("other")}
            aria-invalid={check === "too_low" || check === "too_high"}
            className={`${field} mazed-tabular mt-2`}
            dir="ltr"
          />
        )}
        {check === "too_low" && <p className="mt-1 text-[11.5px] font-bold text-[var(--tone-bad)]">{t("min", { amount: tnd(floor), percent: minPercent })}</p>}
        {check === "too_high" && <p className="mt-1 text-[11.5px] font-bold text-[var(--tone-bad)]">{t("max", { amount: tnd(price) })}</p>}
      </div>

      <div>
        <p id={`${ids}-fin`} className={label}>{t("financingLabel")}</p>
        <div role="radiogroup" aria-labelledby={`${ids}-fin`} className="mt-1.5 flex flex-wrap gap-2">
          {FINANCING.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={financing === f}
              // A second tap takes the choice back: saying nothing is fine.
              onClick={() => setFinancing(financing === f ? null : f)}
              className={chipClass(financing === f)}
            >
              {t(`financing.${f}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={VISIT_NAME_MAX} autoComplete="name" placeholder={t("name")} aria-label={t("name")} className={field} dir="auto" />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} required type="tel" inputMode="tel" autoComplete="tel" placeholder={t("phone")} aria-label={t("phone")} className={field} dir="ltr" />
      </div>

      <div>
        <label htmlFor={`${ids}-message`} className={label}>{t("message")}</label>
        <textarea
          id={`${ids}-message`}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={OFFER_MESSAGE_MAX}
          rows={3}
          className="mt-1.5 w-full rounded-xl border border-border bg-surface px-3 py-2 text-[13px] text-foreground focus:border-gold-soft focus:outline-none"
          dir="auto"
        />
        <div role="group" aria-label={t("phrasesLabel")} className="mt-1 flex flex-wrap gap-2">
          {OFFER_PHRASES.map((k) => {
            const phrase = t(`phrases.${k}`);
            const added = hasPhrase(message, phrase);
            return (
              <button
                key={k}
                type="button"
                aria-pressed={added}
                onClick={() => setMessage((m) => togglePhrase(m, phrase, OFFER_MESSAGE_MAX))}
                className={chipClass(added)}
              >
                {added ? <Check className="size-3.5 shrink-0" /> : <Plus className="size-3.5 shrink-0" />}
                {phrase}
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-[11px] leading-snug text-muted">{t("shared")}</p>
      <button
        type="submit"
        disabled={busy || check !== "ok"}
        className="mazed-btn-luxe tap-target flex h-11 w-full items-center justify-center gap-2 text-[13.5px] disabled:opacity-60"
      >
        {busy && <Loader2 className="size-4 animate-spin" />}
        {amount && check === "ok" ? t("sendAmount", { amount: tnd(amount) }) : t("send")}
      </button>
    </form>
  );
}
