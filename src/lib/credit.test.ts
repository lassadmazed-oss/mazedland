import { describe, it, expect } from "vitest";
import { monthlyPayment, rateChoices, simulateCredit } from "./credit";

describe("monthlyPayment", () => {
  it("matches the textbook instalment", () => {
    // 100 000 at 6 % over 20 years: 716.43 a month.
    expect(monthlyPayment(100_000, 6, 20)).toBeCloseTo(716.43, 2);
  });

  it("is the principal over the months at no interest", () => {
    expect(monthlyPayment(120_000, 0, 10)).toBe(1000);
  });

  it("is nothing for nothing", () => {
    expect(monthlyPayment(0, 8, 10)).toBe(0);
    expect(monthlyPayment(100_000, 8, 0)).toBe(0);
  });
});

describe("simulateCredit", () => {
  it("lends the price less the down payment and adds up what is repaid", () => {
    const r = simulateCredit({ price: 250_000, downPercent: 20, years: 20, ratePercent: 10 });
    expect(r.downPayment).toBe(50_000);
    expect(r.borrowed).toBe(200_000);
    expect(r.monthly).toBe(1930);
    expect(r.total).toBeGreaterThan(463_000);
    expect(r.total).toBeLessThan(464_000);
    expect(r.interest).toBe(r.total - r.borrowed);
  });

  it("costs more over a longer time, and less a month", () => {
    const short = simulateCredit({ price: 300_000, downPercent: 20, years: 10, ratePercent: 10 });
    const long = simulateCredit({ price: 300_000, downPercent: 20, years: 25, ratePercent: 10 });
    expect(long.monthly).toBeLessThan(short.monthly);
    expect(long.interest).toBeGreaterThan(short.interest);
  });

  it("borrows nothing when the down payment is the whole price, and never more than 90 %", () => {
    expect(simulateCredit({ price: 100_000, downPercent: 100, years: 10, ratePercent: 9 }).downPayment).toBe(90_000);
    expect(simulateCredit({ price: 100_000, downPercent: 0, years: 10, ratePercent: 9 }).borrowed).toBe(100_000);
  });
});

describe("rateChoices", () => {
  it("offers whole percents and always includes the default", () => {
    expect(rateChoices(10)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(rateChoices(10.5)).toContain(10.5);
    expect(rateChoices(10.5)).toEqual([...rateChoices(10.5)].sort((a, b) => a - b));
  });
});
