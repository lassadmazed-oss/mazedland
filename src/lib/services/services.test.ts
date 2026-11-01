import { describe, it, expect } from "vitest";
import {
  daysBetween, dueAlerts, inQuietHours, monthlyTotals, nextRenewal, recipientDigits, serviceState, tunisHour,
  type PaidService,
} from "./services";
import { anthropicReading, parseRdap, parseVercelTeam, winsmsReading } from "./providers";
import { parseServiceInput, billingLink } from "./input";

type Judged = Pick<PaidService, "active" | "renews_on" | "lead_days" | "auto_status" | "cycle">;
const svc = (over: Partial<Judged> = {}): Judged => ({
  active: true,
  renews_on: "2026-12-01",
  lead_days: null,
  auto_status: null,
  cycle: "monthly",
  ...over,
});
const OPTS = { defaultLead: 4, dayBefore: true, onDay: true };

describe("serviceState", () => {
  it("counts the days to the date", () => {
    expect(daysBetween("2026-11-27", "2026-12-01")).toBe(4);
    expect(daysBetween("2026-12-03", "2026-12-01")).toBe(-2);
  });

  it("is OK far from the date, soon within the lead, red once past", () => {
    expect(serviceState(svc(), "2026-11-01", 4)).toEqual({ state: "ok", days: 30 });
    expect(serviceState(svc(), "2026-11-27", 4).state).toBe("soon");
    expect(serviceState(svc(), "2026-12-01", 4).state).toBe("today");
    expect(serviceState(svc(), "2026-12-02", 4)).toEqual({ state: "overdue", days: -1 });
  });

  it("uses the service's own lead time over the default", () => {
    expect(serviceState(svc({ lead_days: 14 }), "2026-11-20", 4).state).toBe("soon");
    expect(serviceState(svc({ lead_days: 1 }), "2026-11-28", 4).state).toBe("ok");
  });

  it("puts what the provider says first", () => {
    expect(serviceState(svc({ auto_status: "blocked" }), "2026-11-01", 4).state).toBe("blocked");
    expect(serviceState(svc({ auto_status: "unpaid" }), "2026-11-01", 4).state).toBe("unpaid");
    expect(serviceState(svc({ auto_status: "low", cycle: "prepaid" }), "2026-11-01", 4).state).toBe("low");
  });

  it("asks for a date only where one is expected", () => {
    expect(serviceState(svc({ renews_on: null }), "2026-11-01", 4).state).toBe("unknown");
    expect(serviceState(svc({ renews_on: null, cycle: "prepaid" }), "2026-11-01", 4).state).toBe("ok");
    expect(serviceState(svc({ active: false, auto_status: "blocked" }), "2026-11-01", 4).state).toBe("paused");
  });
});

describe("dueAlerts", () => {
  const stages = (s: Judged, today: string, opts = OPTS) => dueAlerts(s, today, opts).map((a) => a.stage);

  it("sends the lead SMS within the lead, then the day before, then the day", () => {
    expect(stages(svc(), "2026-11-26")).toEqual([]);
    expect(stages(svc(), "2026-11-27")).toEqual(["lead"]);
    expect(stages(svc(), "2026-11-29")).toEqual(["lead"]);
    expect(stages(svc(), "2026-11-30")).toEqual(["day_before"]);
    expect(stages(svc(), "2026-12-01")).toEqual(["day"]);
    expect(stages(svc(), "2026-12-03")).toEqual(["overdue"]);
    expect(stages(svc(), "2026-12-20")).toEqual([]);
  });

  it("ties each reminder to the date, so the next cycle sends again", () => {
    expect(dueAlerts(svc(), "2026-11-27", OPTS)[0]).toMatchObject({ stage: "lead", cycle: "2026-12-01", days: 4 });
    expect(dueAlerts(svc({ renews_on: "2027-01-01" }), "2026-12-28", OPTS)[0].cycle).toBe("2027-01-01");
  });

  it("follows the switches of the day before and the day", () => {
    const off = { defaultLead: 4, dayBefore: false, onDay: false };
    expect(stages(svc(), "2026-11-30", off)).toEqual(["lead"]);
    expect(stages(svc(), "2026-12-01", off)).toEqual([]);
  });

  it("replaces the reminders with a block or an unpaid invoice", () => {
    expect(dueAlerts(svc({ auto_status: "blocked" }), "2026-11-30", OPTS)).toEqual([{ stage: "blocked", cycle: "open", days: null }]);
    expect(stages(svc({ auto_status: "unpaid" }), "2026-11-01")).toEqual(["unpaid"]);
  });

  it("adds a low credit to a reminder, and says nothing for a paused service", () => {
    expect(stages(svc({ auto_status: "low" }), "2026-11-30")).toEqual(["day_before", "low"]);
    expect(stages(svc({ active: false }), "2026-11-30")).toEqual([]);
  });
});

describe("quiet hours", () => {
  it("cross midnight", () => {
    expect(inQuietHours(23, 22, 8)).toBe(true);
    expect(inQuietHours(3, 22, 8)).toBe(true);
    expect(inQuietHours(8, 22, 8)).toBe(false);
    expect(inQuietHours(21, 22, 8)).toBe(false);
  });
  it("can sit inside one day, or be none", () => {
    expect(inQuietHours(13, 12, 14)).toBe(true);
    expect(inQuietHours(14, 12, 14)).toBe(false);
    expect(inQuietHours(3, 0, 0)).toBe(false);
  });
  it("read Tunis time", () => {
    expect(tunisHour(new Date("2026-11-01T23:30:00Z"))).toBe(0);
    expect(tunisHour(new Date("2026-11-01T07:00:00Z"))).toBe(8);
  });
});

describe("cycles and costs", () => {
  it("moves a paid date a month or a year on", () => {
    expect(nextRenewal("2026-12-01", "monthly")).toBe("2027-01-01");
    expect(nextRenewal("2027-01-31", "monthly")).toBe("2027-02-28");
    expect(nextRenewal("2027-10-13", "yearly")).toBe("2028-10-13");
    expect(nextRenewal("2027-10-13", "prepaid")).toBeNull();
  });
  it("adds up a month per currency, a year as its twelfth", () => {
    expect(
      monthlyTotals([
        { cost: 20, cycle: "monthly", active: true, currency: "USD" },
        { cost: 120, cycle: "yearly", active: true, currency: "USD" },
        { cost: 50, cycle: "prepaid", active: true, currency: "TND" },
        { cost: 99, cycle: "monthly", active: false, currency: "USD" },
        { cost: null, cycle: "monthly", active: true, currency: "EUR" },
      ]),
    ).toEqual([{ currency: "USD", amount: 30 }]);
  });
});

describe("provider readings", () => {
  it("reads Vercel's period, price and block", () => {
    const ok = parseVercelTeam({
      softBlock: null,
      billing: { plan: "pro", status: "active", period: { start: 1793516400000, end: 1796112000000 }, invoiceItems: { pro: { price: 2000 } } },
    });
    expect(ok).toMatchObject({ status: "ok", renewsOn: "2026-12-01", costUsd: 20 });
    // The morning of 2026-11-01: blocked for the first invoice.
    const blocked = parseVercelTeam({
      softBlock: { reason: "UNPAID_INVOICE", blockedAt: 1793490720000 },
      billing: { plan: "pro", status: "canceled", period: { end: 1796026492000 } },
    });
    expect(blocked.status).toBe("blocked");
    expect(blocked.detail).toMatchObject({ block: "UNPAID_INVOICE", status: "canceled" });
    expect(parseVercelTeam({ billing: { status: "past_due" } }).status).toBe("unpaid");
    expect(parseVercelTeam({})).toEqual({ status: "ok", detail: expect.any(Object) });
  });

  it("reads a domain's expiry and registrar from RDAP", () => {
    const r = parseRdap({
      status: ["client transfer prohibited"],
      events: [
        { eventAction: "registration", eventDate: "2026-10-13T18:09:49.311Z" },
        { eventAction: "expiration", eventDate: "2027-10-13T18:09:49.311Z" },
      ],
      entities: [{ roles: ["registrar"], vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "HOSTINGER operations, UAB"]]] }],
    });
    expect(r).toMatchObject({ status: "ok", renewsOn: "2027-10-13", detail: { registrar: "HOSTINGER operations, UAB" } });
    expect(parseRdap({ status: ["client hold"] }).status).toBe("blocked");
  });

  it("reads the SMS credit against its threshold", () => {
    expect(winsmsReading({ balance: 9657, licence: "2027-10-04" }, 200)).toMatchObject({ status: "ok", renewsOn: "2027-10-04" });
    expect(winsmsReading({ balance: 150 }, 200).status).toBe("low");
    expect(winsmsReading({ balance: 150 }, 0).status).toBe("ok");
  });

  it("calls the AI credit unpaid only while no call succeeded since", () => {
    const credit = { ok: false, error: "api_credit", cost_usd: 0, created_at: "2026-11-01T10:00:00Z" };
    const fine = { ok: true, error: null, cost_usd: "0.04", created_at: "2026-11-01T09:00:00Z" };
    expect(anthropicReading([credit, fine])).toMatchObject({ status: "unpaid", detail: { calls30: 2, spend30: 0.04 } });
    expect(anthropicReading([{ ...fine, created_at: "2026-11-01T11:00:00Z" }, credit]).status).toBe("ok");
    expect(anthropicReading([]).status).toBe("ok");
  });
});

describe("console input", () => {
  it("takes a whole service, the empties as null", () => {
    const r = parseServiceInput(
      { kind: "domain", provider: " Hostinger ", name: "mazed.immo", cost: "12,99", currency: "USD", cycle: "yearly", renews_on: "2027-10-13", billing_url: "hpanel.hostinger.com/domains", lead_days: 14, purpose: "", account: "" },
      { partial: false },
    );
    expect(r).toEqual({
      ok: true,
      value: expect.objectContaining({ provider: "Hostinger", cost: 12.99, renews_on: "2027-10-13", billing_url: "https://hpanel.hostinger.com/domains", lead_days: 14, purpose: null, account: null }),
    });
  });

  it("names the wrong field", () => {
    expect(parseServiceInput({ provider: "", name: "x" }, { partial: false })).toEqual({ ok: false, error: "provider" });
    expect(parseServiceInput({ renews_on: "2026-02-30" }, { partial: true })).toEqual({ ok: false, error: "renews_on" });
    expect(parseServiceInput({ cost: -1 }, { partial: true })).toEqual({ ok: false, error: "cost" });
    expect(parseServiceInput({ lead_days: 0 }, { partial: true })).toEqual({ ok: false, error: "lead_days" });
    expect(parseServiceInput({ cycle: "weekly" }, { partial: true })).toEqual({ ok: false, error: "cycle" });
  });

  it("touches only what a PATCH sends", () => {
    expect(parseServiceInput({ active: false }, { partial: true })).toEqual({ ok: true, value: { active: false } });
  });

  it("keeps billing links to https", () => {
    expect(billingLink("http://vercel.com")).toBeUndefined();
    expect(billingLink("javascript:alert(1)")).toBeUndefined();
    expect(billingLink("")).toBeNull();
  });
});

describe("recipients", () => {
  it("are WinSMS digits, each once, the others dropped", () => {
    expect(recipientDigits(["+216 98 124 111", "98124111", "0021698124111", "12", "+33 6 12 34 56 78"])).toEqual([
      "21698124111",
      "33612345678",
    ]);
  });
});
