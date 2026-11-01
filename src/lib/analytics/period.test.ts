import { describe, expect, it } from "vitest";
import { daysOf, pctChange, periodQuery, resolvePeriod, tunisDay, tunisMidnight } from "./period";

// 2026-11-01 15:30 UTC = 16:30 in Tunis.
const NOW = new Date("2026-11-01T15:30:00.000Z");

describe("Tunisian days", () => {
  it("names the day in Tunis, not in Greenwich", () => {
    expect(tunisDay(new Date("2026-11-01T23:30:00.000Z"))).toBe("2026-11-02");
    expect(tunisDay(new Date("2026-11-01T22:59:59.000Z"))).toBe("2026-11-01");
  });

  it("finds midnight in Tunis of a day, and refuses what is not a day", () => {
    expect(tunisMidnight("2026-11-01")?.toISOString()).toBe("2026-10-31T23:00:00.000Z");
    expect(tunisMidnight("2026-02-31")).toBeNull();
    expect(tunisMidnight("yesterday")).toBeNull();
    expect(tunisMidnight(undefined)).toBeNull();
  });
});

describe("resolvePeriod", () => {
  it("reads 30 days by default: today included, the 29 days before it", () => {
    const p = resolvePeriod({}, NOW);
    expect(p.key).toBe("30");
    expect(p.days).toBe(30);
    expect(p.fromDay).toBe("2026-10-03");
    expect(p.toDay).toBe("2026-11-01");
    expect(p.to).toEqual(NOW);
    expect(p.from.toISOString()).toBe("2026-10-02T23:00:00.000Z");
  });

  it("compares with the period of the same length just before", () => {
    const p = resolvePeriod({ p: "7" }, NOW);
    expect(p.prevTo).toEqual(p.from);
    expect(p.prevTo.getTime() - p.prevFrom.getTime()).toBe(p.to.getTime() - p.from.getTime());
  });

  it("takes two dates, both days included", () => {
    const p = resolvePeriod({ p: "custom", from: "2026-10-01", to: "2026-10-15" }, NOW);
    expect(p.key).toBe("custom");
    expect(p.days).toBe(15);
    expect(p.fromDay).toBe("2026-10-01");
    expect(p.toDay).toBe("2026-10-15");
    expect(p.to.toISOString()).toBe("2026-10-15T23:00:00.000Z");
  });

  it("falls back to 30 days on a bad custom period, and says so", () => {
    for (const sp of [
      { p: "custom", from: "2026-10-15", to: "2026-10-01" },
      { p: "custom", from: "2020-01-01", to: "2026-10-01" },
      { p: "custom", from: "2026-11-05", to: "2026-11-09" },
      { p: "custom" },
    ]) {
      const p = resolvePeriod(sp, NOW);
      expect(p.key, JSON.stringify(sp)).toBe("30");
      expect(p.fellBack, JSON.stringify(sp)).toBe(true);
    }
    expect(resolvePeriod({ p: "365" }, NOW)).toMatchObject({ key: "30", fellBack: false });
    expect(resolvePeriod({ p: "custom", from: "2026-10-01", to: "2026-10-15" }, NOW).fellBack).toBe(false);
  });

  it("ends a custom period at the end of today in Tunis at the latest", () => {
    const p = resolvePeriod({ p: "custom", from: "2026-10-30", to: "2026-12-31" }, NOW);
    expect(p.to.toISOString()).toBe("2026-11-01T23:00:00.000Z");
    expect(p.toDay).toBe("2026-11-01");
    expect(p.days).toBe(3);
    expect(p.prevTo).toEqual(p.from);
    expect(p.prevFrom.toISOString()).toBe("2026-10-26T23:00:00.000Z");
  });
});

describe("the arithmetic around a period", () => {
  it("gives a change in percent, or nothing to compare with", () => {
    expect(pctChange(120, 100)).toBe(20);
    expect(pctChange(80, 100)).toBe(-20);
    expect(pctChange(5, 0)).toBeNull();
    expect(pctChange(1, 3)).toBe(-66.7);
  });

  it("writes the query string the links carry", () => {
    expect(periodQuery({ key: "30", fromDay: "x", toDay: "y" })).toBe("");
    expect(periodQuery({ key: "7", fromDay: "x", toDay: "y" }, { tab: "demand" })).toBe("?tab=demand&p=7");
    expect(periodQuery({ key: "custom", fromDay: "2026-10-01", toDay: "2026-10-15" })).toBe("?p=custom&from=2026-10-01&to=2026-10-15");
  });

  it("lists every day of a period", () => {
    const p = resolvePeriod({ p: "7" }, NOW);
    expect(daysOf(p)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
  });
});
