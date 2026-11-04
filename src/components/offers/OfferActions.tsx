"use client";

import { useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, HandCoins, Loader2, X } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { useApiError } from "@/lib/useApiError";
import {
  checkCounter,
  counterChips,
  DECLINE_REASONS,
  OFFER_NOTE_MAX,
  parseAmount,
  type OfferAction,
  type OfferDeclineReason,
  type OfferSide,
  type OfferStatus,
} from "@/lib/offers";
import { swapPhrase } from "@/lib/phrases";
import { chipClass } from "@/lib/chips";
import { formatTND } from "@/lib/utils";

type Mode = null | "accept" | "counter" | "decline" | "withdraw";

/**
 * What one side of an open offer can do now (0211). The seller's side
 * accepts, refuses with a reason, or answers once with another price; the
 * buyer accepts or refuses that price, and can withdraw.
 *
 * Every answer is two taps — the choice, then the button that says what it
 * sends — with no browser dialog. The seller types nothing: the other price
 * is a chip (half way, three quarters, the asking price; « Autre montant »
 * keeps a box), the reasons are chips that write the word for the buyer,
 * which opens on a polite default and stays editable.
 */
export function OfferActions({
  offerId,
  side,
  status,
  amount,
  counter,
  asking,
}: {
  offerId: string;
  side: OfferSide;
  status: OfferStatus;
  amount: number;
  counter: number | null;
  asking: number;
}) {
  const t = useTranslations("offers.actions");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const { toast } = useToast();
  const apiError = useApiError();
  const ids = useId();
  const chips = counterChips(amount, asking);
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<number | "other">(() => chips[0] ?? "other");
  const [typed, setTyped] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState<OfferDeclineReason>("low");
  const tnd = (n: number) => `${formatTND(n, locale)} ${tCommon("tnd")}`;

  async function act(action: OfferAction, success: string, extra: { amount?: number } = {}) {
    setBusy(true);
    try {
      const res = await fetch(`/api/offres/${offerId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, note, ...extra }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(apiError(j, t("failed")), res.status === 409 ? "warning" : "error");
        if (res.status === 409) router.refresh();
        return;
      }
      toast(success, "success");
      setMode(null);
      router.refresh();
    } catch {
      toast(t("failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  function open(next: Mode) {
    setMode(next);
    // Each answer opens on its own polite word.
    setNote(next === "accept" ? t("acceptNote") : next === "counter" ? t("counterNote") : next === "decline" ? t(`declineReasons.${reason}`) : "");
  }

  function chooseReason(r: OfferDeclineReason) {
    if (r === reason) return;
    setNote((n) => swapPhrase(n, t(`declineReasons.${reason}`), t(`declineReasons.${r}`), OFFER_NOTE_MAX));
    setReason(r);
  }

  const spin = busy ? <Loader2 className="size-3.5 animate-spin" /> : null;
  const btn = "tap-target inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-bold transition disabled:opacity-60";
  const label = "text-[12px] font-bold text-foreground";
  const area = "w-full rounded-xl border border-border bg-surface px-3 py-2 text-[12.5px] text-foreground focus:border-gold-soft focus:outline-none";
  const row = "mt-1.5 flex flex-wrap gap-2";
  const back = (
    <button type="button" disabled={busy} onClick={() => setMode(null)} className={`${btn} mazed-btn-quiet`}>
      {t("back")}
    </button>
  );
  // The seller's word travels with every answer; the buyer's answers carry none.
  const noteBox = side === "seller" && (
    <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={OFFER_NOTE_MAX} rows={2} aria-label={t("note")} className={area} dir="auto" />
  );

  // ── The buyer ────────────────────────────────────────────────────────────
  if (side === "buyer") {
    if (mode === "withdraw") {
      return (
        <div className="flex flex-wrap items-center gap-2">
          <p className="w-full text-[12px] text-muted">{t("withdrawAsk")}</p>
          <button type="button" disabled={busy} onClick={() => act("withdraw", t("withdrawn"))} className={`${btn} mazed-btn-luxe`}>
            {spin ?? <X className="size-3.5" />} {t("withdrawConfirm")}
          </button>
          {back}
        </div>
      );
    }
    if (status === "countered" && counter != null) {
      if (mode === "accept") {
        return (
          <div className="flex flex-wrap items-center gap-2">
            <p className="w-full text-[12px] text-muted">{t("acceptCounterAsk")}</p>
            <button type="button" disabled={busy} onClick={() => act("accept", t("agreedToast"))} className={`${btn} mazed-btn-luxe`}>
              {spin ?? <Check className="size-3.5" />} {t("acceptAmount", { amount: tnd(counter) })}
            </button>
            {back}
          </div>
        );
      }
      return (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => open("accept")} className={`${btn} mazed-btn-luxe`}>
            <Check className="size-3.5" /> {t("acceptAmount", { amount: tnd(counter) })}
          </button>
          <button type="button" disabled={busy} onClick={() => act("decline", t("declinedCounter"))} className={`${btn} mazed-btn-quiet`}>
            {spin ?? <X className="size-3.5" />} {t("declineCounter")}
          </button>
        </div>
      );
    }
    return (
      <button type="button" disabled={busy} onClick={() => open("withdraw")} className={`${btn} mazed-btn-quiet`}>
        {t("withdraw")}
      </button>
    );
  }

  // ── The seller's side, on a waiting offer ─────────────────────────────────
  if (status !== "pending") return null;

  if (mode === "accept") {
    return (
      <div className="space-y-2.5">
        <p className="text-[12px] text-muted">{t("acceptAsk")}</p>
        {noteBox}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => act("accept", t("accepted"))} className={`${btn} mazed-btn-luxe`}>
            {spin ?? <Check className="size-3.5" />} {t("acceptAmount", { amount: tnd(amount) })}
          </button>
          {back}
        </div>
      </div>
    );
  }

  if (mode === "counter") {
    const value = pick === "other" ? parseAmount(typed) : pick;
    const ok = value != null && checkCounter(value, amount, asking);
    return (
      <div className="space-y-2.5">
        <div>
          <p id={`${ids}-counter`} className={label}>{t("counterLabel")}</p>
          <div role="radiogroup" aria-labelledby={`${ids}-counter`} className={row}>
            {chips.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={pick === c} onClick={() => setPick(c)} className={chipClass(pick === c)}>
                <span dir="ltr" className="mazed-tabular">{formatTND(c, locale)}</span>
                {c === asking && <span className="text-[11px] opacity-80">{t("askingChip")}</span>}
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
              aria-label={t("other")}
              aria-invalid={typed !== "" && !ok}
              placeholder={t("counterRange", { min: formatTND(amount + 1, locale), max: formatTND(asking, locale) })}
              className={`${area} mazed-tabular mt-2 h-10 py-0`}
              dir="ltr"
            />
          )}
          {pick === "other" && typed !== "" && !ok && (
            <p className="mt-1 text-[11.5px] font-bold text-[var(--tone-bad)]">{t("counterRange", { min: formatTND(amount + 1, locale), max: formatTND(asking, locale) })}</p>
          )}
        </div>
        {noteBox}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy || !ok} onClick={() => value != null && act("counter", t("countered"), { amount: value })} className={`${btn} mazed-btn-luxe`}>
            {spin ?? <HandCoins className="size-3.5" />} {ok && value != null ? t("counterSendAmount", { amount: tnd(value) }) : t("counterSend")}
          </button>
          {back}
        </div>
      </div>
    );
  }

  if (mode === "decline") {
    return (
      <div className="space-y-2.5">
        <div>
          <p id={`${ids}-why`} className={label}>{t("declineTitle")}</p>
          <div role="radiogroup" aria-labelledby={`${ids}-why`} className={row}>
            {DECLINE_REASONS.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={reason === r} onClick={() => chooseReason(r)} className={chipClass(reason === r)}>
                {t(`declineReasons.${r}`)}
              </button>
            ))}
          </div>
        </div>
        {noteBox}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => act("decline", t("declined"))} className={`${btn} mazed-btn-luxe`}>
            {spin ?? <X className="size-3.5" />} {t("declineSend")}
          </button>
          {back}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => open("accept")} className={`${btn} mazed-btn-luxe`}>
        <Check className="size-3.5" /> {t("accept")}
      </button>
      <button type="button" disabled={busy} onClick={() => open("counter")} className={`${btn} mazed-btn-quiet`}>
        <HandCoins className="size-3.5" /> {t("counter")}
      </button>
      <button type="button" disabled={busy} onClick={() => open("decline")} className={`${btn} mazed-btn-quiet`}>
        <X className="size-3.5" /> {t("decline")}
      </button>
    </div>
  );
}
