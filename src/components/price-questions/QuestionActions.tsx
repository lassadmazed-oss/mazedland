"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Check, Loader2, Send } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useApiError } from "@/lib/useApiError";
import { answerPrice } from "@/lib/price-questions";
import { priceInWords } from "@/lib/listings/priceCheck";

/**
 * The seller's side of a price question (0222): the price, which goes to the
 * buyer in the site and by SMS — read back in words, a zero too many being the
 * easy slip — or « handled », when he called the buyer instead.
 */
export function QuestionActions({ questionId, rent }: { questionId: string; rent: boolean }) {
  const t = useTranslations("priceQuestions.actions");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const { toast } = useToast();
  const apiError = useApiError();
  const ids = useId();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState<null | "answer" | "done">(null);
  const price = answerPrice(typed);
  const words = price ? priceInWords(price, locale) : null;

  async function act(action: "answer" | "done") {
    if (action === "answer" && !price) {
      toast(t("priceMissing"), "warning");
      return;
    }
    setBusy(action);
    try {
      const res = await fetch(`/api/prix/${questionId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "answer" ? { action, price } : { action }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(apiError(j, t("failed")), res.status === 409 ? "warning" : "error");
        if (res.status === 409) router.refresh();
        return;
      }
      toast(t(action === "answer" ? "answeredToast" : "doneToast"), "success");
      router.refresh();
    } catch {
      toast(t("failed"), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <form
      className="space-y-2 rounded-xl bg-surface-2 p-3 ring-1 ring-border"
      onSubmit={(e) => {
        e.preventDefault();
        void act("answer");
      }}
    >
      <label htmlFor={`${ids}-price`} className="text-[11.5px] font-bold text-foreground">
        {t(rent ? "rentLabel" : "priceLabel")}
      </label>
      <div dir="ltr" className="relative">
        <input
          id={`${ids}-price`}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          inputMode="numeric"
          placeholder={rent ? "1200" : "250000"}
          aria-describedby={words ? `${ids}-words` : undefined}
          className="h-11 w-full rounded-xl border border-border bg-surface px-3 pe-24 text-[15px] font-bold text-foreground placeholder:font-normal placeholder:text-muted focus:border-gold-soft focus:outline-none"
        />
        <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-[12px] font-bold text-muted">
          {tc("tnd")}{rent ? ` ${t("perMonth")}` : ""}
        </span>
      </div>
      {words && (
        <p id={`${ids}-words`} className="text-[12px] font-semibold text-muted" aria-live="polite">
          = {words}
        </p>
      )}
      <p className="text-[11px] leading-snug text-muted">{t("hint")}</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy !== null} className="mazed-btn-luxe tap-target inline-flex h-10 items-center gap-2 px-4 text-[13px] disabled:opacity-60">
          {busy === "answer" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} {t("send")}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void act("done")}
          className="tap-target inline-flex h-10 items-center gap-2 rounded-full border border-border bg-surface px-4 text-[13px] font-bold text-foreground disabled:opacity-60"
        >
          {busy === "done" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} {t("done")}
        </button>
      </div>
    </form>
  );
}
