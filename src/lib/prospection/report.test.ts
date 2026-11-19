import { describe, expect, it } from "vitest";
import { asDay, countFigures, dayBounds, dayLabel, lastDays, reportLine, reportText, tunisiaDay, tunisiaHour } from "./model";

// 2026-11-14 21:30 in Tunisia (UTC+1, no daylight saving) is 20:30 UTC.
const EVENING = new Date("2026-11-14T20:30:00Z");

describe("the Tunisian day", () => {
  it("is the date and hour in Tunisia, not in UTC", () => {
    expect(tunisiaDay(EVENING)).toBe("2026-11-14");
    expect(tunisiaHour(EVENING)).toBe(21);
    // 23:30 UTC is already the next day in Tunisia.
    const late = new Date("2026-11-14T23:30:00Z");
    expect(tunisiaDay(late)).toBe("2026-11-15");
    expect(tunisiaHour(late)).toBe(0);
  });

  it("runs from Tunisian midnight to Tunisian midnight", () => {
    expect(dayBounds("2026-11-14")).toEqual({ start: "2026-11-13T23:00:00.000Z", end: "2026-11-14T23:00:00.000Z" });
  });

  it("lists today and the days before, newest first", () => {
    const days = lastDays(EVENING, 4);
    expect(days).toEqual(["2026-11-14", "2026-11-13", "2026-11-12", "2026-11-11"]);
    expect(lastDays(EVENING).length).toBe(14);
  });

  it("labels a day as day/month", () => {
    expect(dayLabel("2026-11-04")).toBe("04/11");
  });
});

describe("asDay", () => {
  it("keeps a real past date", () => {
    expect(asDay("2026-11-10", EVENING)).toBe("2026-11-10");
    expect(asDay("2026-11-14", EVENING)).toBe("2026-11-14");
  });

  it("falls back to today for anything else", () => {
    expect(asDay(undefined, EVENING)).toBe("2026-11-14");
    expect(asDay("", EVENING)).toBe("2026-11-14");
    expect(asDay("tomorrow", EVENING)).toBe("2026-11-14");
    expect(asDay("2026-02-31", EVENING)).toBe("2026-11-14");
    expect(asDay("2026-11-15", EVENING)).toBe("2026-11-14");
    expect(asDay("2024-01-01", EVENING)).toBe("2026-11-14");
    expect(asDay(20261110, EVENING)).toBe("2026-11-14");
  });
});

describe("countFigures", () => {
  it("counts each member's day by kind, most contacts first", () => {
    const f = countFigures([
      { actor_id: "a", kind: "created" },
      { actor_id: "a", kind: "contacted" },
      { actor_id: "b", kind: "contacted" },
      { actor_id: "b", kind: "contacted" },
      { actor_id: "b", kind: "confirmed" },
      { actor_id: "b", kind: "published" },
      { actor_id: "a", kind: "refused" },
      { actor_id: "a", kind: "no_answer" },
    ]);
    expect(f.map((m) => m.actorId)).toEqual(["b", "a"]);
    expect(f[0]).toEqual({ actorId: "b", created: 0, contacted: 2, yes: 1, online: 1, refused: 0, noAnswer: 0 });
    expect(f[1]).toEqual({ actorId: "a", created: 1, contacted: 1, yes: 0, online: 0, refused: 1, noAnswer: 1 });
  });

  it("leaves out what is not work (notes, SMS, assignments) and events with no member", () => {
    expect(countFigures([{ actor_id: "a", kind: "note" }, { actor_id: "a", kind: "sms" }, { actor_id: "a", kind: "assigned" }, { actor_id: null, kind: "contacted" }])).toEqual([]);
  });
});

describe("the evening notice's words", () => {
  const row = (name: string, contacted: number, yes: number, online: number) => ({ name, created: 0, contacted, yes, online, refused: 0, noAnswer: 0 });

  it("says first messages · yeses · annonces online for a member", () => {
    expect(reportLine(row("Smartimmo", 12, 3, 1))).toBe("Smartimmo 12 · 3 · 1");
  });

  it("names an idle member with zeros: a silent day is what the owner wants to see", () => {
    expect(reportText([row("Smartimmo", 12, 3, 1), row("Sami", 0, 0, 0)])).toBe("Smartimmo 12 · 3 · 1 | Sami 0 · 0 · 0");
  });
});
