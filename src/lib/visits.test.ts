import { describe, it, expect } from "vitest";
import { isProposalReason, nextStatus, OPEN_VISIT_STATUSES, parseProposal, parseSlots, personName, pickSlot, PROPOSAL_REASONS, stageAfterVisit, tunisDay } from "./visits";

const TODAY = "2026-10-26";

describe("personName", () => {
  it("keeps a name, in any script, with its spaces collapsed", () => {
    expect(personName("  Mohamed   Ali Ben Salah ")).toBe("Mohamed Ali Ben Salah");
    expect(personName("Jean-Pierre O'Neil")).toBe("Jean-Pierre O'Neil");
    expect(personName("محمد بن علي")).toBe("محمد بن علي");
    expect(personName("Mme K.")).toBe("Mme K.");
  });

  it("refuses what is not a name: numbers, symbols, a message, the empty, the endless", () => {
    // The name reaches the seller under the platform's name, so a phone
    // number or an instruction in it is refused, not relayed.
    expect(personName("Appelez le 20123456 urgent")).toBeNull();
    expect(personName("Karim (agence)")).toBeNull();
    expect(personName("http://evil.example")).toBeNull();
    expect(personName("K")).toBeNull();
    expect(personName("---")).toBeNull();
    expect(personName("a".repeat(61))).toBeNull();
    expect(personName(42)).toBeNull();
    expect(personName(undefined)).toBeNull();
  });
});

describe("parseSlots", () => {
  it("keeps one to three distinct half-days in the next 30 days", () => {
    expect(parseSlots([{ day: "2026-10-27", part: "morning" }], TODAY)).toEqual([{ day: "2026-10-27", part: "morning" }]);
    expect(
      parseSlots(
        [
          { day: TODAY, part: "evening" },
          { day: "2026-10-27", part: "afternoon" },
          { day: "2026-11-25", part: "morning" },
        ],
        TODAY,
      ),
    ).toHaveLength(3);
  });

  it("refuses none, four, duplicates, the past, beyond 30 days, non-days and unknown parts", () => {
    expect(parseSlots([], TODAY)).toBeNull();
    expect(parseSlots("x", TODAY)).toBeNull();
    const d = (day: string, part = "morning") => ({ day, part });
    expect(parseSlots([d("2026-10-27"), d("2026-10-28"), d("2026-10-29"), d("2026-10-30")], TODAY)).toBeNull();
    expect(parseSlots([d("2026-10-27"), d("2026-10-27")], TODAY)).toBeNull();
    expect(parseSlots([d("2026-10-25")], TODAY)).toBeNull();
    expect(parseSlots([d("2026-11-26")], TODAY)).toBeNull();
    expect(parseSlots([d("2026-02-30")], "2026-02-01")).toBeNull();
    expect(parseSlots([d("2026-10-27", "night")], TODAY)).toBeNull();
  });

  it("follows the console's number of slots and horizon", () => {
    const d = (day: string, part = "morning") => ({ day, part });
    const five = [d("2026-10-27"), d("2026-10-28"), d("2026-10-29"), d("2026-10-30"), d("2026-10-31")];
    expect(parseSlots(five, TODAY, { maxSlots: 5, horizonDays: 30 })).toHaveLength(5);
    expect(parseSlots(five.slice(0, 2), TODAY, { maxSlots: 1, horizonDays: 30 })).toBeNull();
    expect(parseSlots([d("2026-10-29")], TODAY, { maxSlots: 3, horizonDays: 3 })).toHaveLength(1);
    expect(parseSlots([d("2026-10-30")], TODAY, { maxSlots: 3, horizonDays: 3 })).toBeNull();
    expect(parseSlots([d("2027-01-24")], TODAY, { maxSlots: 3, horizonDays: 90 })).toHaveLength(1);
    expect(parseSlots([d("2027-01-25")], TODAY, { maxSlots: 3, horizonDays: 90 })).toBeNull();
  });
});

describe("nextStatus", () => {
  it("lets the seller confirm, decline, then close", () => {
    expect(nextStatus("requested", "confirm", "seller")).toBe("confirmed");
    expect(nextStatus("requested", "decline", "seller")).toBe("declined");
    expect(nextStatus("confirmed", "done", "seller")).toBe("done");
    expect(nextStatus("confirmed", "cancel", "seller")).toBe("cancelled");
    expect(nextStatus("requested", "done", "seller")).toBeNull();
    expect(nextStatus("declined", "confirm", "seller")).toBeNull();
  });

  it("lets the buyer only cancel an open request", () => {
    expect(nextStatus("requested", "cancel", "buyer")).toBe("cancelled");
    expect(nextStatus("confirmed", "cancel", "buyer")).toBe("cancelled");
    expect(nextStatus("requested", "confirm", "buyer")).toBeNull();
    expect(nextStatus("done", "cancel", "buyer")).toBeNull();
  });
});

describe("a seller's proposal of another moment (0231)", () => {
  it("lets the seller propose from a request, revise a proposal, or take a buyer's slot after all", () => {
    expect(nextStatus("requested", "propose", "seller")).toBe("proposed");
    expect(nextStatus("proposed", "propose", "seller")).toBe("proposed");
    expect(nextStatus("proposed", "confirm", "seller")).toBe("confirmed");
    expect(nextStatus("proposed", "decline", "seller")).toBe("declined");
    expect(nextStatus("proposed", "cancel", "seller")).toBe("declined");
    // A confirmed visit is not renegotiated by a proposal; a closed one is closed.
    expect(nextStatus("confirmed", "propose", "seller")).toBeNull();
    expect(nextStatus("declined", "propose", "seller")).toBeNull();
    expect(nextStatus("done", "propose", "seller")).toBeNull();
    expect(nextStatus("proposed", "done", "seller")).toBeNull();
  });

  it("lets the buyer accept only a proposal, and refuse it by calling the visit off", () => {
    expect(nextStatus("proposed", "accept", "buyer")).toBe("confirmed");
    expect(nextStatus("requested", "accept", "buyer")).toBeNull();
    expect(nextStatus("confirmed", "accept", "buyer")).toBeNull();
    expect(nextStatus("proposed", "cancel", "buyer")).toBe("cancelled");
    expect(nextStatus("proposed", "propose", "buyer")).toBeNull();
    // The seller's side cannot accept in the buyer's name.
    expect(nextStatus("proposed", "accept", "seller")).toBeNull();
  });

  it("counts a proposed visit as open: one open request per buyer and annonce", () => {
    expect(OPEN_VISIT_STATUSES).toContain("proposed");
  });

  it("keeps one real half-day inside the window, nothing else", () => {
    expect(parseProposal({ day: "2026-10-30", part: "afternoon" }, TODAY)).toEqual({ day: "2026-10-30", part: "afternoon" });
    // Several, a past day, a day beyond the window, a made-up part, nothing.
    expect(parseProposal([{ day: "2026-10-30", part: "afternoon" }], TODAY)).toBeNull();
    expect(parseProposal({ day: "2026-10-25", part: "morning" }, TODAY)).toBeNull();
    expect(parseProposal({ day: "2026-12-30", part: "morning" }, TODAY, 30)).toBeNull();
    expect(parseProposal({ day: "2026-10-30", part: "midnight" }, TODAY)).toBeNull();
    expect(parseProposal(undefined, TODAY)).toBeNull();
    expect(parseProposal("2026-10-30", TODAY)).toBeNull();
  });

  it("knows the reasons a seller can give, and refuses any other", () => {
    for (const r of PROPOSAL_REASONS) expect(isProposalReason(r)).toBe(true);
    expect(isProposalReason("because")).toBe(false);
    expect(isProposalReason(null)).toBe(false);
    expect(isProposalReason(undefined)).toBe(false);
  });
});

describe("pickSlot and the pipeline", () => {
  it("confirms only a slot the buyer proposed", () => {
    const slots = [{ day: "2026-10-27", part: "morning" as const }];
    expect(pickSlot(slots, { day: "2026-10-27", part: "morning" })).toEqual(slots[0]);
    expect(pickSlot(slots, { day: "2026-10-27", part: "evening" })).toBeNull();
  });

  it("moves a client to « visite » once a visit is set, never back from a later stage", () => {
    expect(stageAfterVisit("new", "confirmed")).toBe("visit");
    expect(stageAfterVisit("contacted", "done")).toBe("visit");
    expect(stageAfterVisit("negotiation", "confirmed")).toBe("negotiation");
    expect(stageAfterVisit("new", "declined")).toBe("new");
  });

  it("reads today in Tunisia", () => {
    expect(tunisDay(new Date("2026-10-26T23:30:00Z"))).toBe("2026-10-27");
  });

  it("always writes YYYY-MM-DD, padded, whatever the engine's habits for a locale", () => {
    expect(tunisDay(new Date("2026-01-05T10:00:00Z"))).toBe("2026-01-05");
    expect(tunisDay(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
    expect(tunisDay()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("is built from the parts, never from a formatted string (an engine may write en-CA as 11/15/2026)", () => {
    const original = Object.getOwnPropertyDescriptor(Intl.DateTimeFormat.prototype, "format")!;
    Object.defineProperty(Intl.DateTimeFormat.prototype, "format", { ...original, get: () => () => "11/15/2026" });
    try {
      expect(tunisDay(new Date("2026-11-15T10:00:00Z"))).toBe("2026-11-15");
    } finally {
      Object.defineProperty(Intl.DateTimeFormat.prototype, "format", original);
    }
  });
});
