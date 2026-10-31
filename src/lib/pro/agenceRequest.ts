/**
 * The agence request (the owner, 2026-10-31): opening an agence and paying
 * its plan are one form and one « Envoyer » — « X wants an agence named …,
 * paid plan … » — and the console approves or refuses it whole. Pure, shared
 * by POST /api/pro/shops and its tests.
 */
import { isUuid } from "@/lib/uuid";
import type { PaymentProvider } from "@/lib/payments/types";
import { ownReceiptPaths } from "@/lib/payments/receipts";

export type RequestPayment = {
  /** The plan's slug; its price is read on the server, never taken from the browser. */
  plan: string;
  provider: PaymentProvider;
  receiptPaths: string[];
  /**
   * The id the page made for the payment: the transfer's reference
   * (« MAZED IMMO-XXXXXXXX ») was shown before the payment existed, and the
   * console matches a bank line by it. Null when it is not one.
   */
  paymentId: string | null;
};

/**
 * What the request says about its plan: nothing (the agence alone — payments
 * closed, the two-step way switched back on, or sent without paying), or the
 * plan, the method and the receipts, all three.
 */
export function parseRequestPayment(
  raw: Record<string, unknown>,
  userId: string,
): { none: true } | { ok: true; value: RequestPayment } | { ok: false; error: "plan" | "provider" | "receipt" } {
  const plan = typeof raw.plan === "string" ? raw.plan.trim() : "";
  if (!plan) return { none: true };
  if (!/^[a-z0-9-]{1,60}$/.test(plan)) return { ok: false, error: "plan" };
  const provider = raw.provider;
  if (provider !== "bank_transfer" && provider !== "d17") return { ok: false, error: "provider" };
  const receiptPaths = ownReceiptPaths(raw.receipt_paths, userId);
  if (!receiptPaths || receiptPaths.length === 0) return { ok: false, error: "receipt" };
  return {
    ok: true,
    value: { plan, provider, receiptPaths, paymentId: isUuid(raw.payment_id) ? (raw.payment_id as string) : null },
  };
}

/**
 * What refusing a request that came with a receipt does with the money (the
 * owner, 2026-10-31: « الأدمين يختار السبب »). No invoice exists yet — it
 * follows an accepted receipt — so there is nothing to cancel by credit note:
 *
 *  - receipt: only the receipt is refused (it is wrong, unreadable, not the
 *    amount); the request stays and the owner sends another from the checkout.
 *  - fix:     the agence's details need correcting; it stays waiting, and so
 *    does its payment, counted — the owner corrects and the request comes
 *    back, with nothing to pay again.
 *  - final:   the agence is refused for good; Mazed Immo sends the money back
 *    by hand and the payment is marked refunded.
 */
export const REFUSAL_OUTCOMES = ["receipt", "fix", "final"] as const;
export type RefusalOutcome = (typeof REFUSAL_OUTCOMES)[number];

export function refusalOutcome(v: unknown): RefusalOutcome | null {
  return REFUSAL_OUTCOMES.find((o) => o === v) ?? null;
}

/**
 * Whether this request may come without its plan: when the form does not
 * ask for one (switched to the two-step way, or no payee to pay), or when
 * « Envoyer sans payer » is allowed (the founding offer: the console offers
 * the period, then opens the agence).
 */
export function planOptional(s: { withPlan: boolean; paymentsOpen: boolean; payLater: boolean }): boolean {
  return !s.withPlan || !s.paymentsOpen || s.payLater;
}
