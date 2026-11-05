/**
 * Price offers (0211): a buyer proposes a price below the asking one; the
 * seller's side accepts, refuses, or answers once with another price, which
 * the buyer accepts or refuses. Nothing is binding: an accepted offer shows
 * each side the other's number, and the sale happens at the notary.
 *
 * Pure — the amounts, the chips, the moves allowed from each status, which
 * annonces take offers — so the rules are tested once and the routes only
 * apply them.
 */
import type { LeadStage } from "@/lib/visits";

export const OFFER_STATUSES = ["pending", "countered", "accepted", "declined", "withdrawn", "expired"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

/** Still waiting on someone: the ones a buyer cannot open twice on one annonce. */
export const OPEN_OFFER_STATUSES: readonly OfferStatus[] = ["pending", "countered"];

export type OfferSide = "seller" | "buyer";
export type OfferAction = "accept" | "decline" | "counter" | "withdraw";

export const FINANCING = ["cash", "loan"] as const;
export type Financing = (typeof FINANCING)[number];

/** What a buyer adds to their word in one tap, and why a seller says no. */
export const OFFER_PHRASES = ["quick", "visit"] as const;
export const DECLINE_REASONS = ["low", "firm", "sold"] as const;
export type OfferDeclineReason = (typeof DECLINE_REASONS)[number];
export const OFFER_MESSAGE_MAX = 600;
export const OFFER_NOTE_MAX = 400;

/**
 * Set in the console: the lowest offer as a percentage of the asking price
 * (`offers_min_percent`), the gap between the quick amounts
 * (`offers_chip_step`), how long the side being waited on has to answer
 * (`offers_days`). These by default.
 */
export type OfferRules = { minPercent: number; chipStep: number; days: number };
export const DEFAULT_OFFER_RULES: OfferRules = { minPercent: 70, chipStep: 5, days: 5 };

/** The lowest amount the seller will be shown, in whole dinars. */
export function offerFloor(price: number, minPercent: number): number {
  return Math.ceil((price * minPercent) / 100);
}

/** A figure as prices are said: to 1 000 TND from 100 000, to 500 from 10 000, to 50 below. */
export function roundOffer(n: number): number {
  const step = n >= 100_000 ? 1000 : n >= 10_000 ? 500 : 50;
  return Math.round(n / step) * step;
}

/**
 * The quick amounts under the price: 1, 2 and 3 times the step below it
 * (−5 %, −10 %, −15 % by default), rounded, each at least the floor and
 * below the price, without repeats.
 */
export function offerChips(price: number, { minPercent, chipStep }: Pick<OfferRules, "minPercent" | "chipStep">): { percent: number; amount: number }[] {
  const floor = offerFloor(price, minPercent);
  const out: { percent: number; amount: number }[] = [];
  for (let i = 1; i <= 3; i++) {
    const percent = chipStep * i;
    if (percent >= 100) break;
    const amount = roundOffer((price * (100 - percent)) / 100);
    if (amount < floor || amount >= price || out.some((c) => c.amount === amount)) continue;
    out.push({ percent, amount });
  }
  return out;
}

/**
 * The seller's quick answers between the offer and the asking price: half
 * way, three quarters of the way, and the asking price itself.
 */
export function counterChips(offer: number, price: number): number[] {
  const gap = price - offer;
  const out: number[] = [];
  for (const n of [roundOffer(offer + gap / 2), roundOffer(offer + (gap * 3) / 4), price]) {
    if (n > offer && n <= price && !out.includes(n)) out.push(n);
  }
  return out;
}

/** How far below the asking price an amount is, in whole percent (« −10 % »). */
export function percentBelow(amount: number, price: number): number {
  return price > 0 ? Math.round(((price - amount) / price) * 100) : 0;
}

/**
 * An amount picked or typed, as whole dinars — « 198000 », « 198 000 »,
 * « 198.000 » — or null when it is not one.
 */
export function parseAmount(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null;
  if (typeof raw !== "string") return null;
  const s = raw.replace(/[\s  ]/g, "");
  const digits = /^\d{1,3}([.,]\d{3})+$/.test(s) ? s.replace(/[.,]/g, "") : /^\d{1,10}$/.test(s) ? s : null;
  if (!digits) return null;
  const n = Number(digits);
  return n > 0 ? n : null;
}

export type AmountCheck = "ok" | "too_low" | "too_high";

/** An offer lies between the floor and the asking price. */
export function checkAmount(amount: number, price: number, minPercent: number): AmountCheck {
  if (amount > price) return "too_high";
  if (amount < offerFloor(price, minPercent)) return "too_low";
  return "ok";
}

/** A counter lies above the buyer's offer and at most the asking price. */
export function checkCounter(counter: number, offer: number, price: number): boolean {
  return counter > offer && counter <= price;
}

/**
 * Where an action leads, for this side, from this status — or null when it
 * may not. The seller's side answers an offer; the buyer answers a counter,
 * and can withdraw while either is open.
 */
export function nextOfferStatus(status: OfferStatus, action: OfferAction, side: OfferSide): OfferStatus | null {
  if (side === "seller") {
    if (status !== "pending") return null;
    if (action === "accept") return "accepted";
    if (action === "decline") return "declined";
    if (action === "counter") return "countered";
    return null;
  }
  if (action === "withdraw") return status === "pending" || status === "countered" ? "withdrawn" : null;
  if (status !== "countered") return null;
  if (action === "accept") return "accepted";
  if (action === "decline") return "declined";
  return null;
}

/** The price both sides agreed on: the counter when the buyer took it, else the offer. */
export function agreedAmount(o: { status: OfferStatus; amount: number; counter_amount: number | null }): number | null {
  if (o.status !== "accepted") return null;
  return o.counter_amount ?? o.amount;
}

/** Where an offer stands now: an open one past its time has expired, whether or not the hourly job ran. */
export function shownStatus(o: { status: OfferStatus; expires_at: string }, now: Date = new Date()): OfferStatus {
  return OPEN_OFFER_STATUSES.includes(o.status) && new Date(o.expires_at).getTime() <= now.getTime() ? "expired" : o.status;
}

/** When the side being waited on must have answered. */
export function offerExpiry(days: number, from: Date = new Date()): string {
  return new Date(from.getTime() + days * 86_400_000).toISOString();
}

/** What the console allows: offers only where the seller said « négociable », and on rents or not. */
export type OfferScope = { onlyNegotiable: boolean; rent: boolean };

/**
 * Whether an annonce takes offers: online, with a price, for sale (or for
 * rent when the console allows it), negotiable when the console asks for it,
 * and not already reserved.
 */
export function takesOffers(
  l: { status: string; price: number | null; price_on_request: boolean; deal_type: string | null; negotiable: boolean; availability: string | null },
  scope: OfferScope,
): boolean {
  if (l.status !== "published" || l.price_on_request || l.price == null || !(Number(l.price) > 0)) return false;
  const rent = l.deal_type === "rent";
  if (rent && !scope.rent) return false;
  if (scope.onlyNegotiable && !l.negotiable) return false;
  return l.availability !== "reserved";
}

/**
 * Whether a new offer reaches the seller by SMS as well as in the site. A
 * seller who ticked « Prix négociable » asked for offers; the others get
 * theirs in the bell only, seen when they next open the site or the app
 * (the owner, 2026-11-05). `onlyNegotiable` is the console's switch.
 */
export function offerReceivedBySms(l: { negotiable: boolean }, onlyNegotiable: boolean): boolean {
  return !onlyNegotiable || l.negotiable;
}

/** An offer moves its client to the negotiation; a decided client stays where they are. */
export function stageAfterOffer(stage: LeadStage): LeadStage {
  return stage === "won" || stage === "lost" ? stage : "negotiation";
}
