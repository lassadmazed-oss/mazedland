import { describe, expect, it } from "vitest";
import { bandLabel, bandTable, funnelSteps, pick, rate, retention } from "./shape";

describe("the funnel", () => {
  it("gives each step its share of the first and what the previous one lost", () => {
    const steps = funnelSteps([
      { key: "start", value: 200 },
      { key: "category", value: 150 },
      { key: "details", value: 100 },
      { key: "submitted", value: 25 },
    ]);
    expect(steps.map((s) => s.share)).toEqual([100, 75, 50, 13]);
    expect(steps.map((s) => s.drop)).toEqual([null, 25, 33, 75]);
  });

  it("never reports a negative loss or divides by nothing", () => {
    const steps = funnelSteps([{ key: "a", value: 0 }, { key: "b", value: 3 }, { key: "c", value: 5 }]);
    expect(steps[0].share).toBe(0);
    expect(steps[1].drop).toBeNull();
    // More at a step than at the one before (annonces published without the form): no loss to report.
    expect(steps[2].drop).toBeNull();
  });
});

describe("the price bands", () => {
  const fmt = (n: number) => n.toLocaleString("fr-TN").replace(/ | /g, " ");
  it("labels the bands of a sale and of a rental", () => {
    expect(bandLabel("sale", 1, fmt)).toBe("< 50 000");
    expect(bandLabel("sale", 3, fmt)).toBe("100 000 – 200 000");
    expect(bandLabel("sale", 6, fmt)).toBe("≥ 800 000");
    expect(bandLabel("rent", 5, fmt)).toBe("≥ 2 000");
    expect(bandLabel("rent", 9, fmt)).toBe("9");
  });

  it("builds one row per category and deal, every band present, biggest first", () => {
    const rows = bandTable([
      { category: "villas", deal: "sale", band: 4, n: 2 },
      { category: "villas", deal: "sale", band: 6, n: 1 },
      { category: "appartements", deal: "rent", band: 2, n: 5 },
      { category: "appartements", deal: "rent", band: 99, n: 5 },
    ]);
    expect(rows[0]).toEqual({ category: "appartements", deal: "rent", bands: [0, 5, 0, 0, 0], total: 5 });
    expect(rows[1]).toEqual({ category: "villas", deal: "sale", bands: [0, 0, 0, 2, 0, 1], total: 3 });
  });
});

describe("small arithmetic", () => {
  it("rates, retention and series", () => {
    expect(rate(1, 3)).toBe(33.3);
    expect(rate(1, 0)).toBeNull();
    expect(retention(2, 8)).toBe(25);
    expect(retention(null, 8)).toBeNull();
    expect(retention(2, 0)).toBeNull();
    expect(pick([{ day: "a", v: 1 }, { day: "b", v: "2" }, { day: "c", v: "x" }], "v")).toEqual([1, 2, 0]);
  });
});
