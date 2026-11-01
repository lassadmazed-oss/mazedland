import { describe, it, expect } from "vitest";
import { offeredPeriod, shiftedGifts } from "./offer";

const NOW = new Date("2026-11-02T09:00:00.000Z");

describe("offeredPeriod", () => {
  it("starts today when the agence has nothing running", () => {
    const p = offeredPeriod({ now: NOW, months: 3, endsOfActive: [] });
    expect(p.startsAt).toEqual(NOW);
    expect(p.endsAt.toISOString()).toBe("2027-02-02T09:00:00.000Z");
  });

  it("queues behind the last period already running or paid ahead", () => {
    const p = offeredPeriod({
      now: NOW,
      months: 3,
      endsOfActive: [new Date("2026-11-20T00:00:00.000Z"), new Date("2026-12-20T00:00:00.000Z")],
    });
    expect(p.startsAt.toISOString()).toBe("2026-12-20T00:00:00.000Z");
    expect(p.endsAt.toISOString()).toBe("2027-03-20T00:00:00.000Z");
  });

  it("ignores a period that already ended", () => {
    const p = offeredPeriod({ now: NOW, months: 1, endsOfActive: [new Date("2026-10-01T00:00:00.000Z")] });
    expect(p.startsAt).toEqual(NOW);
  });

  it("ends on the last day of a short month, like a paid period", () => {
    const p = offeredPeriod({ now: new Date("2026-11-30T09:00:00.000Z"), months: 3, endsOfActive: [] });
    expect(p.endsAt.toISOString()).toBe("2027-02-28T09:00:00.000Z");
  });

  it("never gives less than a month", () => {
    const p = offeredPeriod({ now: NOW, months: 0, endsOfActive: [] });
    expect(p.endsAt.toISOString()).toBe("2026-12-02T09:00:00.000Z");
  });
});

describe("shiftedGifts", () => {
  const D = (iso: string) => new Date(iso);
  // A Business month bought on 2 Nov; a founding gift queued from 29 Nov to 28 Feb.
  const from = D("2026-11-02T10:00:00.000Z");
  const to = D("2026-12-02T10:00:00.000Z");
  const gift = { id: "g", startsAt: D("2026-11-28T23:00:00.000Z"), endsAt: D("2027-02-27T23:00:00.000Z") };

  it("moves a gift that would start inside the new paid period to just after it, with the same length", () => {
    const [m] = shiftedGifts({ gifts: [gift], from, to });
    expect(m.id).toBe("g");
    expect(m.startsAt).toEqual(to);
    expect(m.endsAt.getTime() - m.startsAt.getTime()).toBe(gift.endsAt.getTime() - gift.startsAt.getTime());
  });

  it("leaves a gift that already started alone: its months are being used", () => {
    const running = { id: "r", startsAt: D("2026-10-20T00:00:00.000Z"), endsAt: D("2027-01-20T00:00:00.000Z") };
    expect(shiftedGifts({ gifts: [running], from, to })).toEqual([]);
  });

  it("leaves a gift that starts after the new period anyway, or exactly when it ends", () => {
    const later = { id: "l", startsAt: D("2026-12-15T00:00:00.000Z"), endsAt: D("2027-03-15T00:00:00.000Z") };
    const exact = { id: "e", startsAt: to, endsAt: D("2027-03-02T10:00:00.000Z") };
    expect(shiftedGifts({ gifts: [later, exact], from, to })).toEqual([]);
  });

  it("moves only the gifts that need it", () => {
    const later = { id: "l", startsAt: D("2026-12-15T00:00:00.000Z"), endsAt: D("2027-03-15T00:00:00.000Z") };
    expect(shiftedGifts({ gifts: [gift, later], from, to }).map((m) => m.id)).toEqual(["g"]);
  });
});
