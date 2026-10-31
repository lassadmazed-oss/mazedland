import { describe, it, expect } from "vitest";
import { computeReactivity, reactiveFirst, type ReactiveRules, type RequestRow } from "./reactivity";

const NOW = new Date("2026-11-10T12:00:00.000Z");
const RULES: ReactiveRules = { hours: 24, days: 90, minRequests: 3, minRate: 80 };
const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();
/** A request sent `agoH` hours ago and answered `afterH` hours later (null: never). */
const req = (agoH: number, afterH: number | null, status = "confirmed"): RequestRow => ({
  status: status === "cancelled" ? status : afterH === null ? "requested" : status,
  created_at: at(agoH),
  decided_at: afterH === null ? null : at(agoH - afterH),
});

describe("computeReactivity", () => {
  it("is reactive with enough requests answered in time", () => {
    const r = computeReactivity([req(100, 2), req(200, 5), req(300, 23), req(400, 30)], RULES, NOW);
    expect(r).toMatchObject({ total: 4, fast: 3, rate: 75, reactive: false });
    const ok = computeReactivity([req(100, 2), req(200, 5), req(300, 23), req(400, 1)], RULES, NOW);
    expect(ok).toMatchObject({ total: 4, fast: 4, rate: 100, reactive: true });
  });

  it("needs a minimum of requests: two perfect answers are not a badge", () => {
    const r = computeReactivity([req(100, 1), req(200, 1)], RULES, NOW);
    expect(r).toMatchObject({ total: 2, rate: 100, reactive: false });
  });

  it("counts a request left unanswered past the delay against the agence", () => {
    const r = computeReactivity([req(100, 1), req(200, 1), req(300, 1), req(400, null)], RULES, NOW);
    expect(r).toMatchObject({ total: 4, fast: 3, rate: 75, reactive: false });
  });

  it("does not judge a request still inside its delay", () => {
    const r = computeReactivity([req(100, 1), req(200, 1), req(300, 1), req(5, null)], RULES, NOW);
    expect(r).toMatchObject({ total: 3, fast: 3, rate: 100, reactive: true });
  });

  it("ignores what the buyer cancelled and what is older than the period", () => {
    const r = computeReactivity([req(100, 1), req(200, 1), req(300, 1), req(50, null, "cancelled"), { status: "confirmed", created_at: at(24 * 120), decided_at: at(24 * 120 - 200) }], RULES, NOW);
    expect(r.total).toBe(3);
  });

  it("takes a quick decline for a quick answer, and the exact delay as in time", () => {
    const r = computeReactivity([req(100, 1, "declined"), req(200, 24), req(300, 24.01)], RULES, NOW);
    expect(r.fast).toBe(2);
    expect(r.total).toBe(3);
  });

  it("says nothing when nothing was judged", () => {
    expect(computeReactivity([], RULES, NOW)).toMatchObject({ total: 0, rate: null, reactive: false });
  });
});

describe("reactiveFirst", () => {
  it("puts the reactive ones first and keeps the order inside each group", () => {
    const rows = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
    expect(reactiveFirst(rows, new Set(["c", "e"])).map((r) => r.id)).toEqual(["c", "e", "a", "b", "d"]);
    expect(reactiveFirst(rows, new Set()).map((r) => r.id)).toEqual(["a", "b", "c", "d", "e"]);
  });
});
