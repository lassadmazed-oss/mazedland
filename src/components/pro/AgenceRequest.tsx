"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { useApiError } from "@/lib/useApiError";
import { formatTND, cn } from "@/lib/utils";
import { paymentInstructions, type PayeeDetails } from "@/lib/payments";
import type { PaymentProvider } from "@/lib/payments/types";
import { MAX_RECEIPTS, MAX_RECEIPT_MB, RECEIPT_TYPES, receiptProblem } from "@/lib/payments/receipts";
import { removeReceipts, uploadReceipts } from "@/lib/payments/receiptUpload";
import { trackEvent } from "@/lib/analytics/events";
import { PayeeFields, PayMethodPicker } from "@/components/payments/PayeeInstructions";
import { ShopFields, shopFormStart, type ShopFormValues } from "./ShopForm";
import { ArrowRight, Check, FileText, Loader2, Upload, X } from "lucide-react";

export type RequestPlan = {
  slug: string;
  /** In the page's language. */
  name: string;
  price: number;
  quota: number;
  description: string | null;
};

/** The founding offer while places last (src/lib/pro/founding.ts): nothing to pay, a plan to pick. */
export type FoundingOffer = { left: number; total: number; months: number; plans: RequestPlan[] };

type Step = 0 | 1 | 2;
const STEPS = ["agence", "plan", "pay"] as const;
// With the founding offer there is no payment step: the agence, then its offer.
const FOUNDING_STEPS = ["agence", "offer"] as const;

/** What a reload keeps: the phone often drops the page while the payer is in the D17 or bank app. */
type Draft = { v: 1; values: ShopFormValues; plan: string | null; provider: PaymentProvider | null; paymentId: string; step: Step };

function readDraft(key: string): Draft | null {
  try {
    const d = JSON.parse(window.localStorage.getItem(key) ?? "null") as Draft | null;
    return d && d.v === 1 && d.values && typeof d.paymentId === "string" ? d : null;
  } catch {
    return null;
  }
}

function writeDraft(key: string, d: Draft | null) {
  try {
    if (d) window.localStorage.setItem(key, JSON.stringify(d));
    else window.localStorage.removeItem(key);
  } catch {
    /* private window, storage full: the form simply is not kept */
  }
}

/**
 * Opening an agence, in one request (the owner, 2026-10-31): its page, the
 * plan it takes and that plan's receipt, then one « Envoyer la demande ».
 * Before, the agence was opened first and the plan chosen and paid on
 * another screen. Three short steps on one page — the agence (ShopFields),
 * the plan (cards to tap, nothing to type), the payment (the checkout's
 * method toggles and copyable details, the amount being the plan's price,
 * the reference the payment's id made here) — and POST /api/pro/shops
 * writes the agence and its payment together.
 *
 * What was filled in is kept on the device until it is sent, with the
 * payment's id: a phone that reloads the page after a trip to the D17 app
 * comes back on the same request and the same reference. The receipt itself
 * goes up when the request is sent, so an abandoned form leaves nothing in
 * the bucket.
 *
 * While the founding offer has places (2026-11-03, the owner: the first 50
 * agences pay nothing, and « الوكالة تختار » 40 or 120 annonces), the plan
 * step offers its plans, free, and sends the request from there: no payment
 * step at all. The console's « Ouvrir » then gives the plan picked.
 */
export function AgenceRequest({
  userId,
  initial,
  suggestedName,
  plans,
  payee,
  methods,
  paymentId: freshId,
  payLater,
  founding,
}: {
  userId: string;
  initial: ShopFormValues;
  suggestedName?: string;
  plans: RequestPlan[];
  /** Null while nobody can be paid — only the founding offer is then possible. */
  payee: PayeeDetails | null;
  /** The methods whose details are real (usablePayeeMethods); empty only with the founding offer. */
  methods: PaymentProvider[];
  /** A new payment id, made by the page: the transfer's reference. */
  paymentId: string;
  /** « Envoyer sans payer » is offered (pro_signup_pay_later). */
  payLater: boolean;
  founding?: FoundingOffer | null;
}) {
  const t = useTranslations("pro.request");
  const tc = useTranslations("checkout");
  const tI = useTranslations("checkout.instructions");
  const locale = useLocale();
  const { toast } = useToast();
  const apiError = useApiError();
  const draftKey = `mazed-agence-request:${userId}`;

  const [v, setV] = useState<ShopFormValues>(() => shopFormStart(initial));
  const [step, setStep] = useState<Step>(0);
  const [plan, setPlan] = useState<string | null>(null);
  const [provider, setProvider] = useState<PaymentProvider | null>(methods[0] ?? null);
  const [paymentId, setPaymentId] = useState(freshId);
  const [files, setFiles] = useState<File[]>([]);
  const [imageBusy, setImageBusy] = useState(false);
  const [sending, setSending] = useState<null | "receipts" | "request">(null);
  const [sent, setSent] = useState<null | { id: string; paid: boolean; founding: boolean }>(null);
  // The plans this request picks from: the founding offer's, free, or the paid ones.
  const choices = founding?.plans ?? plans;
  const steps = founding ? FOUNDING_STEPS : STEPS;
  // Remounts the fields once a kept draft is put back, so their own state
  // (a typed city, « Plus d'informations » open) follows the restored values.
  const [fieldsKey, setFieldsKey] = useState(0);
  // Nothing is kept before the kept draft is read: the blank form of the
  // first render would be written over it (React runs effects twice in
  // development, and the second read found the blank one).
  const [restored, setRestored] = useState(false);
  const toastShown = useRef(false);

  // A request begun earlier on this device: back where it was left. The
  // server cannot see the device's storage, so it is read once mounted.
  useEffect(() => {
    const d = readDraft(draftKey);
    if (d) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronising with an external system (the device's storage), which is what an effect is for.
      setV(shopFormStart({ ...initial, ...d.values }));
      if (d.plan && choices.some((p) => p.slug === d.plan)) setPlan(d.plan);
      if (d.provider && methods.includes(d.provider)) setProvider(d.provider);
      setPaymentId(d.paymentId);
      // No payment step with the founding offer, nor without a plan to pay.
      setStep(d.step === 2 && (steps.length < 3 || !d.plan) ? 1 : d.step);
      setFieldsKey((k) => k + 1);
      if (d.values.name?.trim() && !toastShown.current) {
        toastShown.current = true;
        toast(t("restored"), "info");
      }
    }
    setRestored(true);
    // Once, on arrival: what is kept afterwards is this page's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!restored || sent) return;
    writeDraft(draftKey, { v: 1, values: v, plan, provider, paymentId, step });
  }, [restored, draftKey, v, plan, provider, paymentId, step, sent]);

  const chosen = choices.find((p) => p.slug === plan) ?? null;
  const money = (n: number) => `${formatTND(n, locale)} ${t("tnd")}`;

  // The checkout's own instructions, for the plan's price and this request's reference.
  const instructions = useMemo(
    () =>
      payee
        ? paymentInstructions({
            paymentId,
            amountTND: chosen?.price ?? 0,
            payee,
            t: (key, values) => tI(key, values),
          }).filter((m) => methods.includes(m.value))
        : [],
    [paymentId, chosen?.price, payee, methods, tI],
  );
  const active = instructions.find((m) => m.value === provider) ?? instructions[0];

  function go(next: Step) {
    setStep(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    // Cleared: the same file can be chosen again after a removal.
    e.target.value = "";
    const room = MAX_RECEIPTS - files.length;
    const accepted: File[] = [];
    for (const f of picked) {
      if (accepted.length >= room) {
        toast(tc("maxImagesExtra", { max: MAX_RECEIPTS }), "warning");
        break;
      }
      const problem = receiptProblem(f);
      if (problem === "format") toast(tc("badFormat", { name: f.name }), "error");
      else if (problem === "size") toast(tc("tooLarge", { name: f.name, maxMb: MAX_RECEIPT_MB }), "error");
      else accepted.push(f);
    }
    if (accepted.length) setFiles((s) => [...s, ...accepted]);
  }

  /** « pay »: the plan and its receipt; « alone »: the agence only; « founding »: the offer's plan, nothing to pay. */
  async function send(how: "pay" | "alone" | "founding") {
    if (sending) return;
    const withPayment = how === "pay";
    if (withPayment && (!chosen || files.length === 0)) {
      toast(t(chosen ? "receiptNeeded" : "planNeeded"), "warning");
      return;
    }
    if (how === "founding" && !chosen) {
      toast(t("planNeeded"), "warning");
      return;
    }
    let paths: string[] = [];
    if (withPayment) {
      setSending("receipts");
      const up = await uploadReceipts(files, paymentId);
      if (!up.ok) {
        toast(tc(up.reason === "session" ? "sessionExpired" : up.reason === "upload" ? "uploadFailed" : "networkError"), "error");
        setSending(null);
        return;
      }
      paths = up.paths;
    }
    setSending("request");
    try {
      const res = await fetch("/api/pro/shops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...v,
          ...(withPayment ? { plan, provider, receipt_paths: paths, payment_id: paymentId } : {}),
          ...(how === "founding" ? { founding_plan: plan } : {}),
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { id?: string; error?: string; detail?: string };
      if (!res.ok || !j.id) {
        removeReceipts(paths);
        toast(apiError(j, t("sendFailed")), "error");
        return;
      }
      writeDraft(draftKey, null);
      trackEvent("agence_request", {
        plan: how === "alone" ? "none" : plan ?? undefined,
        method: withPayment ? provider ?? undefined : how === "founding" ? "founding" : "none",
        ...(withPayment && chosen ? { value: chosen.price, currency: "TND" } : {}),
      });
      // The receipt went with the request: a payment handed in, counted here.
      if (withPayment) trackEvent("payment_submit", { kind: "subscription", method: provider ?? undefined, where: "signup" });
      setSent({ id: j.id, paid: withPayment, founding: how === "founding" });
      window.scrollTo({ top: 0 });
    } catch {
      removeReceipts(paths);
      toast(tc("networkError"), "error");
    } finally {
      setSending(null);
    }
  }

  if (sent) {
    const bold = (chunks: React.ReactNode) => <span className="font-bold text-foreground" dir="auto">{chunks}</span>;
    const after = sent.paid
      ? ["review", "notify", "open"]
      : sent.founding
        ? ["reviewAlone", "foundingOpen", "foundingEnd"]
        : ["reviewAlone", "notify", "plan"];
    const months = founding?.months ?? 0;
    return (
      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="flex flex-col items-center px-6 pt-8 pb-6 text-center">
          <span className="inline-flex size-16 items-center justify-center rounded-full bg-[var(--tone-ok)] text-white">
            <Check className="size-8" strokeWidth={2.8} />
          </span>
          <h2 className="mt-4 text-[22px] font-extrabold leading-tight">{t("sentTitle")}</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
            {sent.paid && chosen
              ? t.rich("sentBody", { name: v.name.trim(), plan: chosen.name, amount: money(chosen.price), b: bold })
              : sent.founding && chosen
                ? t.rich("sentBodyFounding", { name: v.name.trim(), plan: chosen.name, quota: chosen.quota, months, b: bold })
                : t.rich("sentBodyAlone", { name: v.name.trim(), b: bold })}
          </p>
        </div>
        <ol className="space-y-3 border-t border-border px-6 py-5">
          {after.map((k, i) => (
            <li key={k} className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-gold-faint text-[11px] font-extrabold text-gold ring-1 ring-gold-soft">{i + 1}</span>
              <span className="text-[12.5px] leading-relaxed text-muted">{t(`sentSteps.${k}`, { months })}</span>
            </li>
          ))}
        </ol>
        <div className="border-t border-border p-4">
          <Link href={`/pro/dashboard?shop=${sent.id}` as never} className="mazed-btn-luxe tap-target flex h-12 w-full items-center justify-center gap-1.5 text-[14px]">
            {t("toDashboard")} <ArrowRight className="size-4 rtl:-scale-x-100" />
          </Link>
        </div>
      </div>
    );
  }

  const nextBtn = "mazed-btn-luxe tap-target flex h-12 w-full items-center justify-center gap-1.5 text-[14px] disabled:opacity-60 sm:w-auto sm:px-8";
  const backBtn = "tap-target inline-flex h-12 items-center justify-center rounded-xl border border-border px-5 text-[13.5px] font-bold text-foreground";

  return (
    <div className="space-y-5">
      {/* Where the request stands; a step already done is a tap away. */}
      <ol className={cn("grid gap-1.5", founding ? "grid-cols-2" : "grid-cols-3")} aria-label={t("stepsLabel")}>
        {steps.map((k, i) => {
          const reachable = i < step || (i === 1 && v.name.trim().length > 1 && !!v.governorate) || (i === 2 && !!chosen && step >= 1);
          return (
            <li key={k}>
              <button
                type="button"
                disabled={i === step || !reachable || sending !== null}
                onClick={() => go(i as Step)}
                aria-current={i === step ? "step" : undefined}
                className={cn(
                  "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-start text-[12.5px] font-bold transition",
                  i === step ? "bg-gold-faint text-foreground ring-1 ring-gold-soft" : i < step ? "text-foreground ring-1 ring-border" : "text-muted ring-1 ring-border",
                )}
              >
                <span
                  className={cn(
                    "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[11.5px] font-extrabold",
                    i <= step ? "bg-[var(--gold)] text-[var(--background)]" : "bg-surface-2 text-muted",
                  )}
                >
                  {i < step ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                </span>
                <span className="truncate">{t(`steps.${k}`)}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {step === 0 && (
        // Enter in a field goes on, like « Continuer »; the browser checks what is required first.
        <form
          onSubmit={(e) => {
            e.preventDefault();
            go(1);
          }}
          className="space-y-5"
        >
          <ShopFields key={fieldsKey} v={v} setV={setV} mode="create" suggestedName={suggestedName} onUploading={setImageBusy} />
          <button type="submit" disabled={imageBusy} className={nextBtn}>
            {t("next")} <ArrowRight className="size-4 rtl:-scale-x-100" />
          </button>
        </form>
      )}

      {step === 1 && founding && (
        <section className="space-y-4">
          {/* The founding offer: what it gives, how many places are left, nothing to pay. */}
          <div className="rounded-2xl bg-gold-faint p-4 ring-1 ring-gold-soft">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-gold">{t("foundingEyebrow")}</p>
            <h2 className="mt-1 text-[18px] font-extrabold leading-snug tracking-tight text-foreground">{t("foundingTitle", { months: founding.months })}</h2>
            <p className="mt-1 text-[12.5px] font-semibold text-foreground">{t("foundingLeft", { left: founding.left, total: founding.total })}</p>
          </div>
          <p className="text-[13.5px] font-bold text-foreground">{t("foundingPick")}</p>
          <div role="radiogroup" aria-label={t("foundingPick")} className="grid gap-3 sm:grid-cols-2">
            {founding.plans.map((p) => {
              const on = p.slug === plan;
              return (
                <button
                  key={p.slug}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    setPlan(p.slug);
                    trackEvent("plan_choose", { plan: p.slug, where: "signup_founding" });
                  }}
                  className={cn(
                    "relative flex flex-col rounded-2xl border-2 p-4 text-start transition",
                    on ? "border-[var(--gold)] bg-gold-faint" : "border-border bg-surface hover:border-gold-soft",
                  )}
                >
                  {on && (
                    <span className="absolute end-3 top-3 inline-flex size-5 items-center justify-center rounded-full bg-[var(--gold)] text-[var(--background)]">
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                  )}
                  <span className="text-[15px] font-extrabold text-foreground">{p.name}</span>
                  <span className="mazed-tabular mt-1.5 text-[24px] font-extrabold leading-tight text-foreground">{t("quota", { count: p.quota })}</span>
                  <span className="mt-0.5 text-[12.5px] font-bold text-gold">{t("foundingFree", { months: founding.months })}</span>
                  <span className="mt-2 text-[11.5px] leading-relaxed text-muted">{t("foundingThen", { amount: money(p.price) })}</span>
                </button>
              );
            })}
          </div>
          <p className="rounded-2xl bg-surface-2 px-4 py-3 text-[12px] leading-relaxed text-muted ring-1 ring-border">{t("foundingNote", { months: founding.months })}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => go(0)} disabled={sending !== null} className={backBtn}>{t("back")}</button>
            <button type="button" onClick={() => void send("founding")} disabled={sending !== null} className={cn(nextBtn, "flex-1 sm:flex-none")}>
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" strokeWidth={3} />}
              {sending ? t("sendingRequest") : t("sendFounding")}
            </button>
          </div>
        </section>
      )}

      {step === 1 && !founding && (
        <section className="space-y-4">
          <div>
            <h2 className="text-[17px] font-extrabold tracking-tight">{t("planTitle")}</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{t("planHint")}</p>
          </div>
          <div role="radiogroup" aria-label={t("planTitle")} className="grid gap-3 md:grid-cols-3">
            {plans.map((p) => {
              const on = p.slug === plan;
              return (
                <button
                  key={p.slug}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    setPlan(p.slug);
                    trackEvent("plan_choose", { plan: p.slug, where: "signup" });
                  }}
                  className={cn(
                    "relative flex flex-col rounded-2xl border-2 p-4 text-start transition",
                    on ? "border-[var(--gold)] bg-gold-faint" : "border-border bg-surface hover:border-gold-soft",
                  )}
                >
                  {on && (
                    <span className="absolute end-3 top-3 inline-flex size-5 items-center justify-center rounded-full bg-[var(--gold)] text-[var(--background)]">
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                  )}
                  <span className="text-[15px] font-extrabold text-foreground">{p.name}</span>
                  <span className="mt-1.5 flex items-baseline gap-1">
                    <span className="mazed-tabular text-[26px] font-extrabold text-foreground">{formatTND(p.price, locale)}</span>
                    <span className="text-[12px] text-muted">{t("perMonth")}</span>
                  </span>
                  <span className="mt-0.5 text-[12.5px] font-bold text-gold">{t("quota", { count: p.quota })}</span>
                  {p.description && <span className="mt-2 text-[12px] leading-relaxed text-muted" dir="auto">{p.description}</span>}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => go(0)} className={backBtn}>{t("back")}</button>
            <button
              type="button"
              onClick={() => (chosen ? go(2) : toast(t("planNeeded"), "warning"))}
              className={cn(nextBtn, "flex-1 sm:flex-none")}
            >
              {t("next")} <ArrowRight className="size-4 rtl:-scale-x-100" />
            </button>
          </div>
        </section>
      )}

      {step === 2 && !founding && chosen && active && (
        <section className="space-y-4">
          {/* The request as it will reach the console. */}
          <div className="rounded-2xl border border-border bg-surface p-4">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-gold">{t("summary")}</p>
            <dl className="mt-2 space-y-1 text-[13px]">
              <div className="flex justify-between gap-3"><dt className="text-muted">{t("summaryAgence")}</dt><dd className="min-w-0 truncate font-bold text-foreground" dir="auto">{v.name.trim()}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">{t("summaryPlan")}</dt><dd className="font-bold text-foreground">{chosen.name} · {t("quota", { count: chosen.quota })}</dd></div>
              <div className="flex items-baseline justify-between gap-3 border-t border-border pt-1.5">
                <dt className="font-extrabold text-foreground">{t("summaryAmount")}</dt>
                <dd className="mazed-tabular text-[20px] font-extrabold text-foreground">{money(chosen.price)}</dd>
              </div>
            </dl>
          </div>

          <StepTitle n={1} title={t("stepMethod")} />
          <PayMethodPicker instructions={instructions} provider={active.value} onProvider={setProvider} />
          <StepTitle n={2} title={t("stepPay", { amount: money(chosen.price) })} />
          <PayeeFields active={active} />
          <StepTitle n={3} title={t("stepReceipt")} />
          <div className="space-y-2.5">
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`} className="flex items-center gap-3 rounded-2xl border border-gold-soft bg-gold-faint/40 p-3.5">
                <FileText className="size-5 shrink-0 text-gold" strokeWidth={2} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold">{f.name}</div>
                  <div className="text-[11px] text-muted">{tc("fileSize", { size: (f.size / 1024).toFixed(0) })}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setFiles((s) => s.filter((_, j) => j !== i))}
                  disabled={sending !== null}
                  className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border text-muted hover:text-[var(--tone-bad)] disabled:opacity-50"
                  aria-label={tc("removeFile", { name: f.name })}
                >
                  <X className="size-4" />
                </button>
              </div>
            ))}
            {files.length < MAX_RECEIPTS && (
              <label
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-gold-soft bg-gold-faint/30 p-6 text-center transition hover:border-[var(--gold)]",
                  sending !== null && "pointer-events-none opacity-60",
                )}
              >
                <Upload className="size-6 text-gold" strokeWidth={1.8} />
                <span className="text-[14px] font-bold text-foreground">{files.length === 0 ? tc("chooseFile") : tc("addAnother")}</span>
                <span className="text-[11px] text-muted">{tc("uploadHint", { maxMb: MAX_RECEIPT_MB, max: MAX_RECEIPTS, used: files.length })}</span>
                <input type="file" accept={RECEIPT_TYPES.join(",")} multiple onChange={pick} className="sr-only" />
              </label>
            )}
          </div>

          <p className="rounded-2xl bg-surface-2 px-4 py-3 text-[12px] leading-relaxed text-muted ring-1 ring-border">{t("sendHint")}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => go(1)} disabled={sending !== null} className={backBtn}>{t("back")}</button>
            <button type="button" onClick={() => void send("pay")} disabled={sending !== null || files.length === 0} className={cn(nextBtn, "flex-1 sm:flex-none")}>
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {sending === "receipts" ? t("sendingReceipts") : sending === "request" ? t("sendingRequest") : t("send")}
            </button>
          </div>
          {files.length === 0 && <p className="text-[11.5px] text-muted">{t("receiptFirst")}</p>}
          {payLater && (
            <button
              type="button"
              disabled={sending !== null}
              onClick={() => {
                if (window.confirm(t("payLaterConfirm"))) void send("alone");
              }}
              className="tap-target mx-auto block text-[12px] font-semibold text-muted underline underline-offset-2 hover:text-foreground disabled:opacity-50"
            >
              {t("payLater")}
            </button>
          )}
        </section>
      )}
    </div>
  );
}

function StepTitle({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-2.5 pt-1">
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--gold)] text-[13px] font-extrabold text-[var(--background)]">{n}</span>
      <span className="text-[14px] font-bold text-foreground">{title}</span>
    </div>
  );
}
