import { describe, expect, it } from "vitest";
import {
  asRange, digestIsEmpty, digestText, digestsOf, percent, rangeStart, retentionCutoff, type WaitingRow,
} from "./model";

const NOW = new Date("2026-11-13T09:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const row = (over: Partial<WaitingRow>): WaitingRow => ({
  id: "l", status: "to_contact", assigned_to: "m1", created_by: "m0", confirmed_by: null,
  follow_up_at: null, confirmed_at: null, sms_sent_at: null, published_at: null, ...over,
});

describe("digestsOf", () => {
  it("counts the follow-ups whose date has come, for the member in charge", () => {
    const d = digestsOf([
      row({ id: "a", status: "contacted", follow_up_at: hoursAgo(2) }),
      row({ id: "b", status: "to_contact", follow_up_at: hoursAgo(30) }),
      row({ id: "c", status: "contacted", follow_up_at: new Date(NOW.getTime() + 3_600_000).toISOString() }),
      row({ id: "d", status: "contacted", follow_up_at: null }),
    ], NOW);
    expect(d.get("m1")).toEqual({ followUps: 2, yes: 0, noSms: 0 });
  });

  it("counts a « oui » that has waited for its photos for a day", () => {
    const d = digestsOf([
      row({ id: "a", status: "confirmed", confirmed_at: hoursAgo(30) }),
      row({ id: "b", status: "confirmed", confirmed_at: hoursAgo(3) }),
    ], NOW);
    expect(d.get("m1")).toEqual({ followUps: 0, yes: 1, noSms: 0 });
  });

  it("counts an annonce online whose SMS never left, an hour after it went up", () => {
    const d = digestsOf([
      row({ id: "a", status: "online", published_at: hoursAgo(5), sms_sent_at: null }),
      row({ id: "b", status: "online", published_at: hoursAgo(5), sms_sent_at: hoursAgo(4) }),
      row({ id: "c", status: "online", published_at: hoursAgo(0.2), sms_sent_at: null }),
    ], NOW);
    expect(d.get("m1")).toEqual({ followUps: 0, yes: 0, noSms: 1 });
  });

  it("gives each lead to the member in charge, else who confirmed it, else who made it", () => {
    const d = digestsOf([
      row({ id: "a", status: "contacted", follow_up_at: hoursAgo(1), assigned_to: null, created_by: "m2" }),
      row({ id: "b", status: "confirmed", confirmed_at: hoursAgo(40), assigned_to: null, confirmed_by: "m3", created_by: "m2" }),
    ], NOW);
    expect(d.get("m2")).toEqual({ followUps: 1, yes: 0, noSms: 0 });
    expect(d.get("m3")).toEqual({ followUps: 0, yes: 1, noSms: 0 });
  });

  it("says nothing about a lead that is done", () => {
    expect(digestsOf([row({ status: "declined", follow_up_at: hoursAgo(5) })], NOW).size).toBe(0);
  });
});

describe("the digest's words", () => {
  it("leaves out what is zero", () => {
    expect(digestText({ followUps: 3, yes: 0, noSms: 1 })).toBe("3 à relancer · 1 SMS à renvoyer");
    expect(digestIsEmpty({ followUps: 0, yes: 0, noSms: 0 })).toBe(true);
    expect(digestIsEmpty({ followUps: 0, yes: 2, noSms: 0 })).toBe(false);
  });
});

describe("retention", () => {
  it("looks back that many days", () => {
    expect(retentionCutoff(180, NOW)).toBe("2026-05-17T09:00:00.000Z");
    expect(retentionCutoff(0, NOW)).toBe("2026-11-12T09:00:00.000Z");
  });
});

describe("the board's figures", () => {
  it("reads a share as a whole percent, or nothing when there is nothing to divide by", () => {
    expect(percent(5, 20)).toBe(25);
    expect(percent(1, 3)).toBe(33);
    expect(percent(0, 0)).toBeNull();
  });

  it("offers today, 7 days and 30 days, and falls back to a week", () => {
    expect(asRange("1")).toBe(1);
    expect(asRange("30")).toBe(30);
    expect(asRange("365")).toBe(7);
    expect(asRange(undefined)).toBe(7);
  });

  it("starts a range at midnight in Tunisia, that many days back", () => {
    expect(rangeStart(1, NOW)).toBe("2026-11-12T23:00:00.000Z");
    expect(rangeStart(7, NOW)).toBe("2026-11-06T23:00:00.000Z");
  });
});
