import { describe, expect, it } from "vitest";
import { buildInsights, insightRules, meanAndSd, type InsightInput, type Kpis } from "./insights";

const rules = insightRules(
  {
    analytics_mover_min_percent: 20,
    analytics_anomaly_sigma: 2,
    analytics_zero_search_min: 3,
    analytics_no_contact_min_views: 30,
    analytics_gov_demand_min: 20,
    analytics_gov_low_supply: 5,
  },
  { hours: 24, days: 90, minRequests: 3, minRate: 80 },
  10,
);

const week = (over: Partial<Kpis> = {}): Kpis => ({
  page_views: 1000, visitors: 300, searches: 100, listing_views: 400, publishes: 10, listings_new: 12,
  reveals: 40, visit_requests: 5, favourites: 20, demandes: 4, signups: 15, revenue: 300, ...over,
});

const quiet = (): InsightInput => ({
  thisWeek: week(),
  lastWeek: week(),
  baseline: Array.from({ length: 8 }, () => week()),
  zeroSearches: [],
  topListings: [],
  agences: [],
  governorates: [],
  expiring: 0,
  pendingPayments: { n: 0, amount: 0 },
  noPhoto: 0,
  rules,
});

describe("meanAndSd", () => {
  it("needs three points, then gives the sample deviation", () => {
    expect(meanAndSd([1, 2])).toBeNull();
    const s = meanAndSd([2, 4, 4, 4, 5, 5, 7, 9])!;
    expect(s.mean).toBe(5);
    expect(s.sd).toBeCloseTo(2.138, 3);
  });
});

describe("buildInsights", () => {
  it("says nothing when nothing moved", () => {
    expect(buildInsights(quiet())).toEqual([]);
  });

  it("reports a mover with its number and percent, revenue and contacts first", () => {
    const out = buildInsights({ ...quiet(), thisWeek: week({ reveals: 60, searches: 125, publishes: 11 }) });
    expect(out.map((i) => [i.kind, i.subject])).toEqual([
      ["mover_up", "reveals"],
      ["mover_up", "searches"],
    ]);
    expect(out[0].values).toEqual({ value: 60, previous: 40, pct: 50 });
    expect(out[0].href).toBe("/admin/analytics?p=7");
  });

  it("ignores a move between tiny numbers", () => {
    const out = buildInsights({ ...quiet(), thisWeek: week({ visit_requests: 2 }), lastWeek: week({ visit_requests: 1 }) });
    expect(out).toEqual([]);
  });

  it("flags a week far from its baseline, once per metric", () => {
    const baseline = [90, 110, 100, 95, 105, 100, 98, 102].map((v) => week({ signups: v }));
    const out = buildInsights({ ...quiet(), baseline, thisWeek: week({ signups: 40 }), lastWeek: week({ signups: 45 }) });
    // signups fell 11 % week over week (below the mover bar) but 9 σ below the baseline.
    expect(out.map((i) => i.kind)).toEqual(["anomaly_low"]);
    expect(out[0].values.mean).toBe(100);
    expect(out[0].tone).toBe("bad");
  });

  it("does not repeat an anomaly already told as a mover", () => {
    const baseline = Array.from({ length: 8 }, (_, i) => week({ revenue: 300 + (i % 2) * 10 }));
    const out = buildInsights({ ...quiet(), baseline, thisWeek: week({ revenue: 900 }), lastWeek: week({ revenue: 300 }) });
    expect(out.filter((i) => i.subject === "revenue")).toHaveLength(1);
    expect(out[0].kind).toBe("mover_up");
  });

  it("names a repeated search with no result, and ignores a lone one", () => {
    const out = buildInsights({ ...quiet(), zeroSearches: [{ q: "chalet", n: 4 }, { q: "yourte", n: 1 }] });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("zero_search");
    expect(out[0].values).toEqual({ query: "chalet", count: 4 });
  });

  it("flags an annonce seen a lot with no contact, online only", () => {
    const out = buildInsights({
      ...quiet(),
      topListings: [
        { id: "a", title: "Villa", reference: "MZ-1", views: 45, reveals: 0, visits: 0, status: "published" },
        { id: "b", title: "Terrain", reference: "MZ-2", views: 80, reveals: 1, visits: 0, status: "published" },
        { id: "c", title: "Maison", reference: "MZ-3", views: 90, reveals: 0, visits: 0, status: "archived" },
        { id: "d", title: "Studio", reference: "MZ-4", views: 10, reveals: 0, visits: 0, status: "published" },
      ],
    });
    expect(out.map((i) => i.subject)).toEqual(["a"]);
    expect(out[0].href).toBe("/admin/annonces?q=MZ-1");
  });

  it("flags an agence under the badge's bar, once it has enough requests", () => {
    const out = buildInsights({
      ...quiet(),
      agences: [
        { id: "s1", name: "Immo Sud", slug: "immo-sud", total: 6, answered: 3, fast: 2, late: 2, avg_hours: 40 },
        { id: "s2", name: "Vite", slug: "vite", total: 5, answered: 5, fast: 5, late: 0, avg_hours: 2 },
        { id: "s3", name: "Neuve", slug: "neuve", total: 1, answered: 0, fast: 0, late: 1, avg_hours: null },
      ],
    });
    expect(out.map((i) => i.subject)).toEqual(["s1"]);
    expect(out[0].values).toMatchObject({ name: "Immo Sud", rate: 40, hours: 24 });
  });

  it("names a governorate with demand and few annonces", () => {
    const out = buildInsights({
      ...quiet(),
      governorates: [
        { gov: "Gabès", online: 2, searches: 25, views: 0, demandes: 1 },
        { gov: "Sfax", online: 40, searches: 300, views: 0, demandes: 5 },
        { gov: "Tozeur", online: 0, searches: 3, views: 0, demandes: 0 },
      ],
    });
    expect(out.map((i) => i.subject)).toEqual(["Gabès"]);
    expect(out[0].href).toBe("/admin/demandes?gov=Gab%C3%A8s");
  });

  it("puts waiting receipts above an expiring annonce and keeps to the limit", () => {
    const out = buildInsights({ ...quiet(), expiring: 3, pendingPayments: { n: 2, amount: 118 }, noPhoto: 1, rules: { ...rules, limit: 2 } });
    expect(out.map((i) => i.kind)).toEqual(["pending_payments", "expiring"]);
  });
});
