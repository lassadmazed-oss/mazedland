import { describe, expect, it } from "vitest";
import fr from "../../../messages/fr.json";
import ar from "../../../messages/ar.json";
import { parseRequestPayment, planOptional, refusalOutcome, REFUSAL_OUTCOMES } from "./agenceRequest";

const USER = "11111111-2222-4333-8444-555555555555";
const PAYMENT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("the plan sent with an agence request", () => {
  it("no plan is the agence alone", () => {
    expect(parseRequestPayment({}, USER)).toEqual({ none: true });
    expect(parseRequestPayment({ plan: "  " }, USER)).toEqual({ none: true });
  });

  it("a plan comes with its method and its receipts, all three", () => {
    const ok = parseRequestPayment(
      { plan: "pro-business", provider: "d17", receipt_paths: [`${USER}/${PAYMENT}-1-0.webp`], payment_id: PAYMENT },
      USER,
    );
    expect(ok).toEqual({
      ok: true,
      value: { plan: "pro-business", provider: "d17", receiptPaths: [`${USER}/${PAYMENT}-1-0.webp`], paymentId: PAYMENT },
    });
    expect(parseRequestPayment({ plan: "pro-pro", receipt_paths: [`${USER}/a.webp`] }, USER)).toEqual({ ok: false, error: "provider" });
    expect(parseRequestPayment({ plan: "pro-pro", provider: "cash", receipt_paths: [`${USER}/a.webp`] }, USER)).toEqual({ ok: false, error: "provider" });
    expect(parseRequestPayment({ plan: "pro-pro", provider: "bank_transfer" }, USER)).toEqual({ ok: false, error: "receipt" });
    expect(parseRequestPayment({ plan: "pro-pro", provider: "bank_transfer", receipt_paths: [] }, USER)).toEqual({ ok: false, error: "receipt" });
  });

  it("a plan that is not a slug is refused before any lookup", () => {
    expect(parseRequestPayment({ plan: "pro'; drop", provider: "d17", receipt_paths: [`${USER}/a.webp`] }, USER)).toEqual({ ok: false, error: "plan" });
  });

  it("a receipt in someone else's folder refuses the whole request", () => {
    const other = "99999999-2222-4333-8444-555555555555";
    expect(
      parseRequestPayment({ plan: "pro-pro", provider: "d17", receipt_paths: [`${USER}/a.webp`, `${other}/b.webp`] }, USER),
    ).toEqual({ ok: false, error: "receipt" });
    expect(parseRequestPayment({ plan: "pro-pro", provider: "d17", receipt_paths: [`${USER}/../${other}/b.webp`] }, USER)).toEqual({ ok: false, error: "receipt" });
  });

  it("three receipts at most; a payment id that is not one is dropped", () => {
    const paths = [0, 1, 2, 3, 4].map((i) => `${USER}/r-${i}.webp`);
    const r = parseRequestPayment({ plan: "pro-pro", provider: "bank_transfer", receipt_paths: paths, payment_id: "nope" }, USER);
    expect(r).toMatchObject({ ok: true, value: { receiptPaths: paths.slice(0, 3), paymentId: null } });
  });
});

describe("when the plan may be left out", () => {
  it("only when the form does not ask for it, or « Envoyer sans payer » is on", () => {
    expect(planOptional({ withPlan: true, paymentsOpen: true, payLater: false })).toBe(false);
    expect(planOptional({ withPlan: true, paymentsOpen: true, payLater: true })).toBe(true);
    expect(planOptional({ withPlan: false, paymentsOpen: true, payLater: false })).toBe(true);
    expect(planOptional({ withPlan: true, paymentsOpen: false, payLater: false })).toBe(true);
  });
});

describe("what refusing a request does with its payment", () => {
  it("only the console's three choices pass", () => {
    expect(REFUSAL_OUTCOMES).toEqual(["receipt", "fix", "final"]);
    expect(refusalOutcome("fix")).toBe("fix");
    expect(refusalOutcome("refund")).toBeNull();
    expect(refusalOutcome("constructor")).toBeNull();
    expect(refusalOutcome(undefined)).toBeNull();
  });

  it("each one says what it does, in both languages, with the amount", () => {
    for (const msgs of [fr, ar]) {
      const outcomes = msgs.adminShops.outcomes as Record<string, { label: string; hint: string; done: string }>;
      for (const o of REFUSAL_OUTCOMES) {
        expect(outcomes[o].label).toBeTruthy();
        expect(outcomes[o].hint).toBeTruthy();
        expect(outcomes[o].done).toBeTruthy();
      }
      // The money is named where it moves: kept for a correction, sent back on a final refusal.
      expect(outcomes.fix.hint).toContain("{amount}");
      expect(outcomes.final.hint).toContain("{amount}");
    }
  });
});
