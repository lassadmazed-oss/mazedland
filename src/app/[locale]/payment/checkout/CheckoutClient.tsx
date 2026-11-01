"use client";

import { WhatsAppHelp } from "@/components/ui/WhatsAppHelp";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Check,
  Upload,
  Loader2,
  ArrowRight,
  AlertCircle,
  FileText,
  X,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useApiError } from "@/lib/useApiError";
import { formatTND, cn } from "@/lib/utils";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import type { ProviderInstructions } from "@/lib/payments";
import type { PaymentProvider } from "@/lib/payments/types";
import { MAX_RECEIPTS, MAX_RECEIPT_MB, RECEIPT_TYPES, receiptProblem } from "@/lib/payments/receipts";
import { removeReceipts, uploadReceipts } from "@/lib/payments/receiptUpload";
import { PayeeFields, PayMethodPicker } from "@/components/payments/PayeeInstructions";
import { pickedBeforeReady } from "@/lib/pickedBeforeReady";
import { trackEvent } from "@/lib/analytics/events";

interface Props {
  paymentId: string;
  amount: number;
  listing: {
    id: string;
    title: string;
    governorate: string;
    heroPhotoPath: string | null;
  } | null;
  instructions: ProviderInstructions[];
  locale: string;
  /** The seller already sent a receipt and an admin has not ruled on it yet. */
  receiptUnderReview: boolean;
  /** An admin refused the last receipt, with this motif (empty when none was kept): a new one is sent from here. */
  refusedReason?: string | null;
  /** What is paid for (page.tsx): an agence's plan, a placement or an annonce's fee. */
  subject?: { kind: "plan" | "promo" | "fee"; product: string | null; shop: string | null; shopId: string | null };
  /** When set (listing-fee payments), shows a "Modifier l'annonce" link so the
   *  seller can go back and fix the listing before paying. Full locale-prefixed
   *  href to the edit page (which returns here after saving). */
  editHref?: string;
}

/*
 * There is one kind of payment. `KIND_TITLES` mapped four — caution, achat,
 * paiement final, frais d'annonce — and the three auction ones are unreachable
 * now that nothing can create them. Its title and line are
 * `checkout.feeLabel` / `checkout.feeBody`.
 */

export function CheckoutClient({
  paymentId,
  amount,
  listing,
  subject,
  instructions,
  locale,
  receiptUnderReview,
  refusedReason = null,
  editHref,
}: Props) {
  const t = useTranslations("checkout");
  const tc = useTranslations("common");
  const { toast } = useToast();
  const apiError = useApiError();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [provider, setProvider] = useState<PaymentProvider>(
    instructions[0]?.value ?? "bank_transfer",
  );
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // Sent from this page, then « Envoyer un autre reçu »: the payment now
  // waits for review, as if the page had opened on it.
  const [sentHere, setSentHere] = useState(false);
  const underReview = receiptUnderReview || sentHere;
  const [cancelling, setCancelling] = useState(false);
  const [cancelled, setCancelled] = useState(false);

  // The checkout opened for this payment: the start of the payment funnel.
  useEffect(() => {
    if (receiptUnderReview) return;
    trackEvent("payment_start", { kind: subject?.kind ?? "fee", amount, payment: paymentId });
    // Once per payment shown, not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentId]);

  async function cancelPayment() {
    if (cancelling) return;
    const ok = window.confirm(t("cancelConfirm"));
    if (!ok) return;
    trackEvent("payment_cancel", { kind: subject?.kind ?? "fee", payment: paymentId });
    setCancelling(true);
    try {
      const res = await fetch(`/api/payments/${paymentId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        toast(apiError(data, t("cancelFailed")), "error");
        setCancelling(false);
        return;
      }
      setCancelled(true);
    } catch {
      toast(t("cancelNetworkError"), "error");
      setCancelling(false);
    }
  }

  const active = useMemo(
    () => instructions.find((p) => p.value === provider) ?? instructions[0],
    [provider, instructions],
  );

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length === 0) return;
    const remaining = MAX_RECEIPTS - files.length;
    if (remaining <= 0) {
      toast(t("maxImages", { max: MAX_RECEIPTS }), "warning");
      return;
    }
    const accepted: File[] = [];
    for (const f of picked) {
      if (accepted.length >= remaining) {
        toast(t("maxImagesExtra", { max: MAX_RECEIPTS }), "warning");
        break;
      }
      const problem = receiptProblem(f);
      if (problem === "format") {
        toast(t("badFormat", { name: f.name }), "error");
        continue;
      }
      if (problem === "size") {
        toast(t("tooLarge", { name: f.name, maxMb: MAX_RECEIPT_MB }), "error");
        continue;
      }
      accepted.push(f);
    }
    // Reset so the same file can be re-picked after a removal.
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (accepted.length === 0) return;
    // Choosing the receipt sends it: one tap, not a choice and then a button.
    // Several can be chosen at once in the picker; a wrong one is replaced
    // from the « sent » screen, or after a refusal. The button below stays
    // for a send that failed.
    const next = [...files, ...accepted];
    setFiles(next);
    void submit(next);
  }

  async function submit(list: File[] = files) {
    if (list.length === 0 || submitting) return;
    setSubmitting(true);
    // Every object put in the bucket this attempt is taken back if a later
    // upload or the attach call fails (no orphans).
    const up = await uploadReceipts(list, paymentId);
    if (!up.ok) {
      toast(t(up.reason === "session" ? "sessionExpired" : up.reason === "upload" ? "uploadFailed" : "networkError"), "error");
      trackEvent("upload_failed", { kind: "receipt", reason: up.reason });
      setSubmitting(false);
      return;
    }
    try {
      const res = await fetch(`/api/payments/${paymentId}/receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receipt_paths: up.paths, provider }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        removeReceipts(up.paths);
        toast(apiError(data, t("submitFailed")), "error");
        setSubmitting(false);
        return;
      }
      // Google only: the route counts it for the site (src/lib/analytics/server-events.ts).
      trackEvent("payment_submit", { kind: subject?.kind ?? "fee", method: provider, amount, payment: paymentId }, {}, { firstParty: false });
      setSubmitted(true);
      setSentHere(true);
    } catch {
      removeReceipts(up.paths);
      toast(t("networkError"), "error");
      setSubmitting(false);
    }
  }

  if (cancelled) {
    return (
      <div className="min-h-screen bg-background">
        <main className="max-w-md mx-auto px-4 py-10 lg:py-16">
          {/* Obviously-cancelled card — the previous version was a few
              tiny lines on a white page that read as "blank" to several
              testers. The red ring, full-width card surface, and the
              prominent return-to-listing CTA make the state legible at
              a glance. */}
          <div className="rounded-2xl border-2 border-red-300 bg-red-50 p-6 text-center shadow-lg">
            <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-full bg-red-500 text-white shadow-md shadow-red-500/30">
              <X className="h-8 w-8" strokeWidth={2.8} />
            </div>
            <h1 className="mt-4 text-[22px] font-extrabold leading-tight text-red-900">
              {t("cancelledTitle")}
            </h1>
            <p className="mt-2 text-[13px] text-red-900/80 leading-relaxed">
              {t("cancelledBody")}
            </p>
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {listing && (
                <a
                  href={`/${locale}/annonces/${listing.id}`}
                  className="inline-flex h-11 items-center justify-center rounded-[var(--radius)] bg-white border border-red-200 text-red-900 px-5 text-[13px] font-bold hover:border-red-400"
                >
                  {t("viewListing")}
                </a>
              )}
              <a
                href={`/${locale}`}
                className="inline-flex h-11 items-center justify-center rounded-[var(--radius)] bg-[var(--gold)] text-white px-5 text-[13px] font-bold hover:bg-[var(--gold-bright)]"
              >
                {t("home")}
                <ArrowRight className="ms-1.5 h-4 w-4 rtl:-scale-x-100" />
              </a>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (submitted) {
    // Final "what happens after validation" step depends on what was paid.
    // "passe en ligne automatiquement" was wrong even before the pivot: a
    // captured fee moves the annonce to `pending_review`, not to `published`.
    // Paying buys a publication, not a way past moderation.
    // What happens once the receipt is accepted depends on what was paid for.
    const steps = [
      t("sentSteps.review"),
      t("sentSteps.notify"),
      subject?.kind === "plan" ? t("sentSteps.plan") : subject?.kind === "promo" ? t("sentSteps.promo") : t("sentSteps.publish"),
    ];
    const bold = (chunks: React.ReactNode) => (
      <span className="font-bold text-foreground">{chunks}</span>
    );
    return (
      <div className="min-h-screen bg-background">
        <main className="mx-auto max-w-md px-4 py-12 lg:py-16">
          <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
            <div className="flex flex-col items-center bg-gradient-to-b from-emerald-500/10 to-transparent px-6 pt-8 pb-6 text-center">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/30">
                <Check className="h-8 w-8" strokeWidth={2.8} />
              </div>
              <h1 className="mt-4 text-[22px] font-extrabold leading-tight">
                {t("sentTitle")}
              </h1>
              <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--foreground-muted)]">
                {listing
                  ? t.rich("sentBodyFor", {
                      amount: formatTND(amount, locale),
                      title: listing.title,
                      b: bold,
                    })
                  : t.rich("sentBody", { amount: formatTND(amount, locale), b: bold })}
              </p>
            </div>

            <ol className="space-y-3 border-t border-[var(--border)] px-6 py-5">
              {steps.map((s, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--gold-faint)] text-[11px] font-extrabold text-[var(--gold)] ring-1 ring-[var(--gold-soft)]">
                    {i + 1}
                  </span>
                  <span className="text-[12.5px] leading-relaxed text-[var(--foreground-muted)]">
                    {s}
                  </span>
                </li>
              ))}
            </ol>

            <div className="flex flex-col gap-2 border-t border-[var(--border)] p-4">
              {/* Where a seller actually wants to go after paying: the list of
                  their own annonces, where this one now shows "En vérification".
                  The caution branch that stood here led to a bid page. */}
              {/* A plan belongs to the agence: back to its subscription tab. */}
              <a
                href={
                  subject?.kind === "plan" && subject.shopId
                    ? `/${locale}/pro/dashboard?shop=${subject.shopId}&tab=abonnement`
                    : `/${locale}/account/listings`
                }
                className="inline-flex h-11 items-center justify-center rounded-[var(--radius)] bg-[var(--gold)] px-5 text-[13px] font-bold text-white hover:bg-[var(--gold-bright)]"
              >
                {subject?.kind === "plan" && subject.shopId ? t("toPlan") : t("myListings")}{" "}
                <ArrowRight className="ms-1.5 h-4 w-4 rtl:-scale-x-100" />
              </a>
              {listing && (
                <a
                  href={`/${locale}/annonces/${listing.id}`}
                  className="inline-flex h-11 items-center justify-center rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] px-5 text-[13px] font-semibold hover:border-[var(--gold-soft)]"
                >
                  {t("viewListing")}
                </a>
              )}
              {/* The receipt went the moment it was chosen: a wrong one is
                  replaced here, while it waits for review. */}
              <button
                type="button"
                onClick={() => {
                  setFiles([]);
                  setSubmitting(false);
                  setSubmitted(false);
                }}
                className="tap-target mx-auto text-[12px] font-semibold text-[var(--foreground-muted)] underline underline-offset-2 hover:text-foreground"
              >
                {t("sendAnother")}
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-md px-4 py-6 lg:max-w-5xl lg:py-12">
        <div className="lg:grid lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start lg:gap-8">
        {/* LEFT (desktop) / TOP (mobile) — order summary */}
        <div className="space-y-4 lg:sticky lg:top-[calc(var(--desktop-nav-h)+1.5rem)]">
        {/* ── HERO: what you're paying + how much ── */}
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 text-center">
          {listing?.heroPhotoPath && (
            <div className="relative mb-4 hidden aspect-[16/10] overflow-hidden rounded-xl bg-[var(--surface-2)] lg:block">
              <Image
                src={propertyPhotoUrl(listing.heroPhotoPath)}
                alt=""
                fill
                sizes="360px"
                className="object-cover"
              />
            </div>
          )}
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--gold)]">
            {subject?.kind === "plan"
              ? t("planLabel", { plan: subject.product ?? "" })
              : subject?.kind === "promo"
                ? subject.product ?? t("promoLabel")
                : t("feeLabel")}
          </div>
          {(subject?.kind === "plan" ? subject.shop : listing?.title) && (
            <div className="mt-0.5 text-[14px] font-bold leading-tight line-clamp-1" dir="auto">
              {subject?.kind === "plan" ? subject.shop : listing?.title}
            </div>
          )}
          <div className="mazed-tabular gradient-gold-text mt-3 text-[40px] font-extrabold leading-none">
            {formatTND(amount, locale)}
            <span className="ms-1 text-[12px] font-bold uppercase text-[var(--foreground-muted)]">
              {tc("tnd")}
            </span>
          </div>
          <p className="mx-auto mt-2 max-w-xs text-[11.5px] leading-snug text-[var(--foreground-muted)]">
            {subject?.kind === "plan" ? t("planBody") : subject?.kind === "promo" ? t("promoBody") : t("feeBody")}
          </p>
          {editHref && (
            // Made a mistake? Go back and fix the listing before paying — saving
            // returns straight here to finish payment (no duplicate listing/fee).
            <a
              href={editHref}
              className="tap-target mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold text-[var(--gold)] ring-1 ring-[var(--gold-soft)] transition hover:bg-[var(--gold-faint)]"
            >
              {t("editListing")}
            </a>
          )}
        </section>

        {/* Reaching checkout with a payment in `pending_review` means the
            receipt arrived and is waiting for an admin. A refused one lands
            here too (page.tsx), with the admin's motif: the next receipt
            answers it. */}
        {underReview ? (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-900">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{t("receiptUnderReview")}</span>
          </div>
        ) : refusedReason !== null ? (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] text-red-900">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{refusedReason ? t("receiptRefused", { reason: refusedReason }) : t("receiptRefusedNoReason")}</span>
          </div>
        ) : null}
        </div>

        {/* RIGHT (desktop) / BELOW (mobile) — payment steps */}
        <div className="mt-4 space-y-4 lg:mt-0">
        {/* ── STEP 1: choose method (big toggles) ── */}
        <Step n={1} title={t("stepMethod")} />
        <PayMethodPicker instructions={instructions} provider={provider} onProvider={setProvider} />

        {/* ── STEP 2: pay — copyable bank details ── */}
        {active && (
          <>
            <Step n={2} title={t("stepPay")} />
            <PayeeFields active={active} />
          </>
        )}

        {/* ── STEP 3: upload receipt ── */}
        <Step n={3} title={t("stepUpload")} />
        <div className="space-y-2.5">
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} className="flex items-center gap-3 rounded-2xl border border-[var(--gold-soft)] bg-[var(--gold-faint)]/40 p-3.5">
              <FileText className="size-5 shrink-0 text-[var(--gold)]" strokeWidth={2} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold">{f.name}</div>
                <div className="text-[11px] text-[var(--foreground-muted)]">
                  {t("fileSize", { size: (f.size / 1024).toFixed(0) })}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                disabled={submitting}
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--foreground-muted)] hover:border-red-300 hover:text-red-600 disabled:opacity-50"
                aria-label={t("removeFile", { name: f.name })}
              >
                <X className="size-4" strokeWidth={2} />
              </button>
            </div>
          ))}
          {files.length < MAX_RECEIPTS && (
            <label
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-[var(--gold-soft)] bg-[var(--gold-faint)]/30 p-7 text-center transition hover:border-[var(--gold)] hover:bg-[var(--gold-faint)]/60",
                submitting && "pointer-events-none opacity-60",
              )}
            >
              <Upload className="size-7 text-[var(--gold)]" strokeWidth={1.8} />
              <span className="text-[14px] font-bold text-foreground">
                {files.length === 0 ? t("chooseFile") : t("addAnother")}
              </span>
              <span className="text-[11px] text-[var(--foreground-muted)]">
                {t("uploadHint", { maxMb: MAX_RECEIPT_MB, max: MAX_RECEIPTS, used: files.length })}
              </span>
              <input
                ref={(el) => {
                  fileInputRef.current = el;
                  // A receipt chosen before the page was ready is sent, not lost.
                  pickedBeforeReady(el);
                }}
                type="file"
                accept={RECEIPT_TYPES.join(",")}
                multiple
                onChange={onPickFile}
                className="sr-only"
              />
            </label>
          )}
        </div>

        {/* ── Big submit: the sending in progress, and the retry when it failed.
            With nothing chosen yet there is nothing for it to do — choosing
            the receipt sends it. ── */}
        {files.length > 0 && (
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting}
            className={cn(
              "inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-[15px] font-extrabold transition-all",
              submitting
                ? "cursor-not-allowed bg-[var(--surface-2)] text-[var(--foreground-muted)]"
                : "bg-[var(--gold)] text-white shadow-[var(--shadow-gold)] hover:bg-[var(--gold-bright)]",
            )}
          >
            {submitting ? (
              <><Loader2 className="size-5 animate-spin" /> {t("sending")}</>
            ) : (
              <><Upload className="size-5" strokeWidth={2.5} /> {t("send", { count: files.length })}</>
            )}
          </button>
        )}
        <p className="text-center text-[11px] text-[var(--foreground-muted)]">
          {files.length > 0 ? t("hintReady") : t("hintEmpty")}
        </p>

        {/* Cancel — small, out of the way. A refused payment is already
            closed; only a new receipt moves it. */}
        {!underReview && refusedReason === null && (
          <button
            type="button"
            onClick={cancelPayment}
            disabled={cancelling}
            className="mx-auto block text-[12px] font-semibold text-[var(--foreground-subtle)] underline underline-offset-2 hover:text-red-500 disabled:opacity-50"
          >
            {cancelling ? t("cancelling") : t("cancelPayment")}
          </button>
        )}
        {/* A question about paying goes to a person (src/lib/contact.ts). */}
        <div className="flex justify-center">
          <WhatsAppHelp topic="payment" />
        </div>
        </div>
        </div>
      </main>
    </div>
  );
}

function Step({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-2.5 pt-1">
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--gold)] text-[13px] font-extrabold text-white">
        {n}
      </span>
      <span className="text-[14px] font-bold text-foreground">{title}</span>
    </div>
  );
}
