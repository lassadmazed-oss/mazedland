import { describe, it, expect } from "vitest";
import { offeredPeriod } from "./offer";

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
