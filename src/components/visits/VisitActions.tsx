"use client";

import { useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarDays, Check, Loader2, Plus, X } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { useApiError } from "@/lib/useApiError";
import { useSetting } from "@/components/settings/SettingsProvider";
import { PROPOSAL_NOTE_MAX, PROPOSAL_REASONS, tunisDay, VISIT_PARTS, type ProposalReason, type VisitPart, type VisitSide, type VisitSlot, type VisitStatus } from "@/lib/visits";
import { dayLabel, nextDays } from "@/lib/dayChips";
import { DECLINE_REASONS, PART_HOURS, SELLER_NOTE_MAX, SELLER_PHRASES, type DeclineReason } from "@/lib/visitChoices";
import { hasPhrase, swapPhrase, togglePhrase } from "@/lib/phrases";
import { chipClass } from "@/lib/chips";
import { formatDate } from "@/lib/utils";

type Proposal = { day: string | null; part: VisitPart | null };

/**
 * What one side of a visit can do now (0174). The seller's side picks one of
 * the buyer's half-days to confirm, may add a word, declines, or later says
 * it took place; the buyer can cancel.
 *
 * The seller types nothing: the half-day, the hour inside it and the usual
 * phrases are chips that write the word for the buyer, which opens on a
 * polite default and stays editable. « Refuser » asks why, in chips too, and
 * can offer another moment — the same day and time-of-day chips as the
 * buyer's form — written into the word the buyer receives with the refusal.
 */
export function VisitActions({
  visitId,
  side,
  status,
  slots,
  slotLabels,
}: {
  visitId: string;
  side: VisitSide;
  status: VisitStatus;
  slots: VisitSlot[];
  /** The slots, already said in the reader's language. */
  slotLabels: string[];
}) {
  const t = useTranslations("visits.actions");
  const tChips = useTranslations("visits.chips");
  const tParts = useTranslations("visits.parts");
  const locale = useLocale();
  const router = useRouter();
  const { toast } = useToast();
  const apiError = useApiError();
  const ids = useId();
  const horizon = useSetting("visits_horizon_days");
  const [busy, setBusy] = useState<string | null>(null);
  const [pick, setPick] = useState(0);
  const [hour, setHour] = useState<number | null>(null);
  const [note, setNote] = useState(() => t("defaultNote"));
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState<DeclineReason>("slots");
  const [declineNote, setDeclineNote] = useState(() => t("declineReasons.slots"));
  // Another moment, proposed by the seller (0231): the day and time of day, why (a choice), and the word with it.
  const [proposing, setProposing] = useState(false);
  const [pro, setPro] = useState<Proposal>({ day: null, part: null });
  const [proReason, setProReason] = useState<ProposalReason | null>(null);
  const [proNote, setProNote] = useState("");
  const [today] = useState(tunisDay);

  async function act(action: "confirm" | "propose" | "accept" | "decline" | "done" | "cancel", success: string) {
    if (action === "cancel" && !window.confirm(t(side === "buyer" ? "cancelConfirm" : "cancelSellerConfirm"))) return;
    setBusy(action);
    try {
      const res = await fetch(`/api/visites/${visitId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          slot: action === "confirm" ? slots[pick] : action === "propose" ? { day: pro.day, part: pro.part } : undefined,
          reason: action === "propose" ? proReason : undefined,
          // Each answer carries its own word; « Visite faite », an acceptance
          // and an annulation carry none, so the one already sent stays.
          note: action === "confirm" ? note : action === "decline" ? declineNote : action === "propose" ? proNote : "",
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(apiError(j, t("failed")), "error");
        return;
      }
      toast(success, "success");
      // The visit stays on the seller's side while it waits: the panel closes, the card shows the proposal.
      if (action === "propose") setProposing(false);
      router.refresh();
    } catch {
      toast(t("failed"), "error");
    } finally {
      setBusy(null);
    }
  }

  const spin = (a: string) => (busy === a ? <Loader2 className="size-3.5 animate-spin" /> : null);
  const btn = "tap-target inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-bold transition disabled:opacity-60";
  const label = "text-[12px] font-bold text-foreground";
  const area = "w-full rounded-xl border border-border bg-surface px-3 py-2 text-[12.5px] text-foreground focus:border-gold-soft focus:outline-none";
  const row = "mt-1.5 flex flex-wrap gap-2";

  if (side === "buyer") {
    // The seller proposed another moment: take it in one tap, or say it does not suit.
    if (status === "proposed") {
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!!busy} onClick={() => act("accept", t("acceptToast"))} className={`${btn} mazed-btn-luxe`}>
              {spin("accept") ?? <Check className="size-3.5" />} {t("accept")}
            </button>
            <button type="button" disabled={!!busy} onClick={() => act("cancel", t("cancelled"))} className={`${btn} mazed-btn-quiet`}>
              {spin("cancel") ?? <X className="size-3.5" />} {t("refuseProposal")}
            </button>
          </div>
          <p className="text-[11.5px] text-muted">{t("otherTimes")}</p>
        </div>
      );
    }
    if (status !== "requested" && status !== "confirmed") return null;
    return (
      <button type="button" disabled={!!busy} onClick={() => act("cancel", t("cancelled"))} className={`${btn} mazed-btn-quiet`}>
        {spin("cancel")} {t("cancel")}
      </button>
    );
  }

  if (status === "requested" || status === "proposed") {
    const hourPhrase = (h: number | null) => (h == null ? null : t("hourPhrase", { hour: h }));
    const choose = (i: number) => {
      // The hours offered follow the half-day; one named for another goes.
      if (hour != null && slots[i]?.part !== slots[pick]?.part) {
        setNote((n) => swapPhrase(n, hourPhrase(hour), null));
        setHour(null);
      }
      setPick(i);
    };

    const chooseHour = (h: number) => {
      const next = hour === h ? null : h;
      setNote((n) => swapPhrase(n, hourPhrase(hour), hourPhrase(next), SELLER_NOTE_MAX));
      setHour(next);
    };

    const chooseReason = (r: DeclineReason) => {
      if (r === reason) return;
      setDeclineNote((n) => swapPhrase(n, t(`declineReasons.${reason}`), t(`declineReasons.${r}`), SELLER_NOTE_MAX));
      setReason(r);
    };

    // The phrase a proposal writes into the word: « I can receive you Friday, in the afternoon. »
    const proPhrase = (p: Proposal) =>
      p.day && p.part ? t("proposePhrase", { day: formatDate(`${p.day}T12:00:00Z`, locale, "weekday"), part: tParts(p.part) }) : null;
    const choosePro = (patch: Partial<Proposal>) => {
      const next = { ...pro, ...patch };
      // A day needs a time of day to be a moment: the buyer's own first one, until another is tapped.
      if (next.day && !next.part) next.part = slots[0]?.part ?? "morning";
      if (!next.day) next.part = patch.part ?? null;
      setProNote((n) => swapPhrase(n, proPhrase(pro), proPhrase(next), PROPOSAL_NOTE_MAX));
      setPro(next);
    };
    const chooseProReason = (r: ProposalReason) => {
      if (r === proReason) return;
      setProNote((n) => swapPhrase(n, proReason ? t(`proposeReasons.${proReason}`) : null, t(`proposeReasons.${r}`), PROPOSAL_NOTE_MAX));
      setProReason(r);
    };

    if (proposing) {
      const words = { today: tChips("today"), tomorrow: tChips("tomorrow") };
      const ready = !!(pro.day && pro.part && proReason);
      return (
        <div className="space-y-2.5">
          <div>
            <p id={`${ids}-prop`} className={label}>{t("proposeTitle")}</p>
            <div role="radiogroup" aria-labelledby={`${ids}-prop`} className={row}>
              {nextDays(today, horizon).map((d) => (
                <button key={d} type="button" role="radio" aria-checked={pro.day === d} onClick={() => choosePro({ day: pro.day === d ? null : d })} className={chipClass(pro.day === d)}>
                  {dayLabel(d, today, locale, words)}
                </button>
              ))}
            </div>
            <div role="radiogroup" aria-labelledby={`${ids}-prop`} className={row}>
              {VISIT_PARTS.map((p) => (
                <button key={p} type="button" role="radio" aria-checked={pro.part === p} onClick={() => choosePro({ part: p })} className={chipClass(pro.part === p)}>
                  {tChips(p)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p id={`${ids}-why2`} className={label}>{t("proposeWhy")}</p>
            <div role="radiogroup" aria-labelledby={`${ids}-why2`} className={row}>
              {PROPOSAL_REASONS.map((r) => (
                <button key={r} type="button" role="radio" aria-checked={proReason === r} onClick={() => chooseProReason(r)} className={chipClass(proReason === r)}>
                  {t(`proposeReasons.${r}`)}
                </button>
              ))}
            </div>
          </div>
          <textarea
            value={proNote}
            onChange={(e) => setProNote(e.target.value)}
            maxLength={PROPOSAL_NOTE_MAX}
            rows={2}
            aria-label={t("proposeNote")}
            className={area}
            dir="auto"
          />
          {!ready ? <p className="text-[11.5px] text-muted">{t("proposeMissing")}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!!busy || !ready} onClick={() => act("propose", t("proposed"))} className={`${btn} mazed-btn-luxe`}>
              {spin("propose") ?? <Check className="size-3.5" />} {t("proposeSend")}
            </button>
            <button type="button" disabled={!!busy} onClick={() => setProposing(false)} className={`${btn} mazed-btn-quiet`}>
              {t("back")}
            </button>
          </div>
        </div>
      );
    }

    if (declining) {
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
          {reason === "slots" && (
            <button
              type="button"
              disabled={!!busy}
              onClick={() => {
                setDeclining(false);
                setProposing(true);
              }}
              className={`${btn} mazed-btn-quiet`}
            >
              <CalendarDays className="size-3.5" /> {t("propose")}
            </button>
          )}
          <textarea
            value={declineNote}
            onChange={(e) => setDeclineNote(e.target.value)}
            maxLength={SELLER_NOTE_MAX}
            rows={2}
            aria-label={t("note")}
            className={area}
            dir="auto"
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!!busy} onClick={() => act("decline", t("declined"))} className={`${btn} mazed-btn-luxe`}>
              {spin("decline") ?? <X className="size-3.5" />} {t("declineSend")}
            </button>
            <button type="button" disabled={!!busy} onClick={() => setDeclining(false)} className={`${btn} mazed-btn-quiet`}>
              {t("back")}
            </button>
          </div>
        </div>
      );
    }

    const hours = PART_HOURS[slots[pick]?.part ?? "morning"];
    return (
      <div className="space-y-2.5">
        {status === "proposed" ? <p className="text-[12px] font-bold text-[var(--tone-warn)]">{t("proposalWaiting")}</p> : null}
        <div>
          <p id={`${ids}-slot`} className={label}>{t("pickSlot")}</p>
          <div role="radiogroup" aria-labelledby={`${ids}-slot`} className={row}>
            {slotLabels.map((text, i) => (
              <button key={i} type="button" role="radio" aria-checked={pick === i} onClick={() => choose(i)} className={chipClass(pick === i)}>
                {text}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p id={`${ids}-hour`} className={label}>{t("hourLabel")}</p>
          <div role="radiogroup" aria-labelledby={`${ids}-hour`} className={row}>
            {hours.map((h) => (
              <button key={h} type="button" role="radio" aria-checked={hour === h} onClick={() => chooseHour(h)} className={chipClass(hour === h)}>
                {t("hourChip", { hour: h })}
              </button>
            ))}
          </div>
        </div>
        <div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={SELLER_NOTE_MAX}
            rows={2}
            placeholder={t("notePlaceholder")}
            aria-label={t("note")}
            className={area}
            dir="auto"
          />
          <div role="group" aria-label={t("phrasesLabel")} className="mt-1 flex flex-wrap gap-2">
            {SELLER_PHRASES.map((k) => {
              const phrase = t(`phrases.${k}`);
              const added = hasPhrase(note, phrase);
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={added}
                  onClick={() => setNote((n) => togglePhrase(n, phrase, SELLER_NOTE_MAX))}
                  className={chipClass(added)}
                >
                  {added ? <Check className="size-3.5 shrink-0" /> : <Plus className="size-3.5 shrink-0" />}
                  {phrase}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!!busy} onClick={() => act("confirm", t("confirmed"))} className={`${btn} mazed-btn-luxe`}>
            {spin("confirm") ?? <Check className="size-3.5" />} {t("confirm")}
          </button>
          <button type="button" disabled={!!busy} onClick={() => setProposing(true)} className={`${btn} mazed-btn-quiet`}>
            <CalendarDays className="size-3.5" /> {t(status === "proposed" ? "reviseProposal" : "propose")}
          </button>
          <button type="button" disabled={!!busy} onClick={() => setDeclining(true)} className={`${btn} mazed-btn-quiet`}>
            <X className="size-3.5" /> {t("decline")}
          </button>
        </div>
      </div>
    );
  }

  if (status === "confirmed") {
    return (
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!!busy} onClick={() => act("done", t("doneToast"))} className={`${btn} mazed-btn-luxe`}>
          {spin("done") ?? <Check className="size-3.5" />} {t("done")}
        </button>
        <button type="button" disabled={!!busy} onClick={() => act("cancel", t("cancelled"))} className={`${btn} mazed-btn-quiet`}>
          {spin("cancel")} {t("cancel")}
        </button>
      </div>
    );
  }
  return null;
}
