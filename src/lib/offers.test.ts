import { describe, expect, it } from "vitest";
import {
  agreedAmount,
  checkAmount,
  checkCounter,
  counterChips,
  nextOfferStatus,
  offerChips,
  offerExpiry,
  offerFloor,
  parseAmount,
  percentBelow,
  roundOffer,
  shownStatus,
  stageAfterOffer,
  takesOffers,
  type OfferAction,
  type OfferStatus,
} from "./offers";

describe("the amounts of an offer", () => {
  it("rounds as prices are said", () => {
    expect(roundOffer(209_300)).toBe(209_000);
    expect(roundOffer(187_500)).toBe(188_000);
    expect(roundOffer(47_260)).toBe(47_500);
    expect(roundOffer(1_140)).toBe(1_150);
  });

  it("offers −5, −10 and −15 % on 220 000 TND, the example given to the owner", () => {
    expect(offerChips(220_000, { minPercent: 70, chipStep: 5 })).toEqual([
      { percent: 5, amount: 209_000 },
      { percent: 10, amount: 198_000 },
      { percent: 15, amount: 187_000 },
    ]);
    expect(offerFloor(220_000, 70)).toBe(154_000);
  });

  it("never proposes under the floor, at the price, or the same amount twice", () => {
    // A 10 % step with a 75 % floor: −10 % and −20 % only.
    expect(offerChips(100_000, { minPercent: 75, chipStep: 10 }).map((c) => c.percent)).toEqual([10, 20]);
    // A tiny price: rounding to 50 would repeat or reach the price.
    const chips = offerChips(100, { minPercent: 10, chipStep: 1 });
    expect(new Set(chips.map((c) => c.amount)).size).toBe(chips.length);
    expect(chips.every((c) => c.amount < 100)).toBe(true);
  });

  it("reads what people type", () => {
    expect(parseAmount("198000")).toBe(198_000);
    expect(parseAmount("198 000")).toBe(198_000);
    expect(parseAmount("198 000")).toBe(198_000);
    expect(parseAmount("198.000")).toBe(198_000);
    expect(parseAmount("1,250,000")).toBe(1_250_000);
    expect(parseAmount(198_000.4)).toBe(198_000);
    for (const bad of ["", "abc", "198.5", "-5", "0", 0, -3, null, undefined, {}, "12e5"]) {
      expect(parseAmount(bad)).toBeNull();
    }
  });

  it("keeps an offer between the floor and the price", () => {
    expect(checkAmount(154_000, 220_000, 70)).toBe("ok");
    expect(checkAmount(153_999, 220_000, 70)).toBe("too_low");
    expect(checkAmount(220_000, 220_000, 70)).toBe("ok");
    expect(checkAmount(220_001, 220_000, 70)).toBe("too_high");
  });

  it("keeps a counter above the offer and at most the price", () => {
    expect(checkCounter(205_000, 198_000, 220_000)).toBe(true);
    expect(checkCounter(220_000, 198_000, 220_000)).toBe(true);
    expect(checkCounter(198_000, 198_000, 220_000)).toBe(false);
    expect(checkCounter(221_000, 198_000, 220_000)).toBe(false);
    expect(counterChips(198_000, 220_000)).toEqual([209_000, 215_000, 220_000]);
    // Close to the price, the chips collapse instead of repeating.
    expect(counterChips(219_000, 220_000)).toEqual([220_000]);
  });

  it("says how far below the price an offer is", () => {
    expect(percentBelow(198_000, 220_000)).toBe(10);
    expect(percentBelow(220_000, 220_000)).toBe(0);
  });
});

describe("the moves of an offer", () => {
  const all: OfferAction[] = ["accept", "decline", "counter", "withdraw"];
  const statuses: OfferStatus[] = ["pending", "countered", "accepted", "declined", "withdrawn", "expired"];

  it("lets the seller answer a waiting offer, once", () => {
    expect(nextOfferStatus("pending", "accept", "seller")).toBe("accepted");
    expect(nextOfferStatus("pending", "decline", "seller")).toBe("declined");
    expect(nextOfferStatus("pending", "counter", "seller")).toBe("countered");
    expect(nextOfferStatus("pending", "withdraw", "seller")).toBeNull();
    for (const s of statuses.filter((x) => x !== "pending")) {
      for (const a of all) expect(nextOfferStatus(s, a, "seller")).toBeNull();
    }
  });

  it("lets the buyer answer a counter, and withdraw while open", () => {
    expect(nextOfferStatus("countered", "accept", "buyer")).toBe("accepted");
    expect(nextOfferStatus("countered", "decline", "buyer")).toBe("declined");
    expect(nextOfferStatus("countered", "withdraw", "buyer")).toBe("withdrawn");
    expect(nextOfferStatus("pending", "withdraw", "buyer")).toBe("withdrawn");
    // The buyer cannot accept their own offer, nor counter.
    expect(nextOfferStatus("pending", "accept", "buyer")).toBeNull();
    expect(nextOfferStatus("countered", "counter", "buyer")).toBeNull();
    for (const s of ["accepted", "declined", "withdrawn", "expired"] as const) {
      for (const a of all) expect(nextOfferStatus(s, a, "buyer")).toBeNull();
    }
  });

  it("agrees on the counter when the buyer took it", () => {
    expect(agreedAmount({ status: "accepted", amount: 198_000, counter_amount: 205_000 })).toBe(205_000);
    expect(agreedAmount({ status: "accepted", amount: 198_000, counter_amount: null })).toBe(198_000);
    expect(agreedAmount({ status: "declined", amount: 198_000, counter_amount: 205_000 })).toBeNull();
  });

  it("shows an open offer past its time as expired, before the hourly job runs", () => {
    const now = new Date("2026-11-04T12:00:00Z");
    expect(shownStatus({ status: "pending", expires_at: "2026-11-04T11:59:00Z" }, now)).toBe("expired");
    expect(shownStatus({ status: "countered", expires_at: "2026-11-04T11:59:00Z" }, now)).toBe("expired");
    expect(shownStatus({ status: "pending", expires_at: "2026-11-05T12:00:00Z" }, now)).toBe("pending");
    expect(shownStatus({ status: "accepted", expires_at: "2026-11-01T00:00:00Z" }, now)).toBe("accepted");
    expect(offerExpiry(5, now)).toBe("2026-11-09T12:00:00.000Z");
  });

  it("moves a shop's client to the negotiation, never back from a decided stage", () => {
    expect(stageAfterOffer("new")).toBe("negotiation");
    expect(stageAfterOffer("visit")).toBe("negotiation");
    expect(stageAfterOffer("won")).toBe("won");
    expect(stageAfterOffer("lost")).toBe("lost");
  });
});

describe("which annonces take offers", () => {
  const sale = { status: "published", price: 220_000, price_on_request: false, deal_type: "sale", negotiable: true, availability: "available" };
  const scope = { onlyNegotiable: true, rent: false };

  it("takes them on a negotiable sale with a price", () => {
    expect(takesOffers(sale, scope)).toBe(true);
  });

  it("asks for « négociable » only when the console does", () => {
    expect(takesOffers({ ...sale, negotiable: false }, scope)).toBe(false);
    expect(takesOffers({ ...sale, negotiable: false }, { ...scope, onlyNegotiable: false })).toBe(true);
  });

  it("leaves rents out unless the console lets them in", () => {
    expect(takesOffers({ ...sale, deal_type: "rent" }, scope)).toBe(false);
    expect(takesOffers({ ...sale, deal_type: "rent" }, { ...scope, rent: true })).toBe(true);
  });

  it("needs a price, a live annonce and nobody holding it", () => {
    expect(takesOffers({ ...sale, price: null }, scope)).toBe(false);
    expect(takesOffers({ ...sale, price: 0 }, scope)).toBe(false);
    expect(takesOffers({ ...sale, price_on_request: true }, scope)).toBe(false);
    expect(takesOffers({ ...sale, status: "pending_review" }, scope)).toBe(false);
    expect(takesOffers({ ...sale, availability: "reserved" }, scope)).toBe(false);
  });
});
