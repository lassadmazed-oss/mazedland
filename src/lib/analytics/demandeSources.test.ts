import { describe, expect, it } from "vitest";
import { countDemandeSources } from "./demandeSources";

const tap = (via: string | null) => ({ name: "demande_cta", via, mode: null });
const saved = (via: string | null, mode = "new") => ({ name: "demande_create", via, mode });

describe("countDemandeSources", () => {
  it("counts taps and new demandes per place, the best place first", () => {
    const out = countDemandeSources([
      tap("top"), tap("top"), tap("top"), saved("top"),
      tap("card"), tap("card"), saved("card"), saved("card"),
      tap("listing"),
    ]);
    expect(out).toEqual([
      { via: "card", taps: 2, demandes: 2 },
      { via: "top", taps: 3, demandes: 1 },
      { via: "listing", taps: 1, demandes: 0 },
    ]);
  });

  it("puts a demande from nowhere known under « other », and never an edit", () => {
    const out = countDemandeSources([saved(null), saved("evil"), saved("top", "edit")]);
    expect(out).toEqual([{ via: "other", taps: 0, demandes: 2 }]);
  });

  it("ignores a tap from an unknown place and other events", () => {
    expect(countDemandeSources([tap("nowhere"), tap(null), { name: "search", via: "top", mode: null }])).toEqual([]);
  });
});
