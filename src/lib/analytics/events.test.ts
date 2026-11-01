import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EVENT_NAMES,
  EVENT_NAME_PATTERN,
  buildBatch,
  cleanParams,
  cleanPath,
  configureFirstParty,
  firstPartyAllowed,
  gaParams,
  isUuid,
  pendingFirstParty,
  resetFirstParty,
  resetImpressions,
  trackEvent,
  trackImpressions,
} from "./events";
import { dailyVisitorKey, deviceOf, localeOf, readBatch, rowsFromBatch } from "./server-events";

describe("the names", () => {
  it("are all of the shape the table accepts, each once", () => {
    for (const n of EVENT_NAMES) expect(n, n).toMatch(EVENT_NAME_PATTERN);
    expect(new Set(EVENT_NAMES).size).toBe(EVENT_NAMES.length);
  });
});

describe("what an event may carry", () => {
  it("keeps short strings, numbers, booleans and small lists, and drops the rest", () => {
    expect(cleanParams({ q: " villa  sfax ", n: 3.14159, ok: true, ids: ["a", "b", 3 as unknown as string], bad: { x: 1 } as unknown as string, Bad: "x" })).toEqual({
      q: "villa sfax",
      n: 3.14,
      ok: true,
      ids: ["a", "b"],
    });
  });

  it("takes a phone number or an e-mail out of a text", () => {
    expect(cleanParams({ q: "villa 20 123 456 sfax" })).toEqual({ q: "villa [phone] sfax" });
    expect(cleanParams({ q: "contact moi@mail.tn" })).toEqual({ q: "contact [email]" });
  });

  it("stops before the size cap", () => {
    const big = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, "x".repeat(90)]));
    expect(JSON.stringify(cleanParams(big)).length).toBeLessThanOrEqual(2000);
  });

  it("gives Google lists as text", () => {
    expect(gaParams({ surface: "home", ids: ["a", "b"], n: 2 })).toEqual({ surface: "home", ids: "a,b", n: 2 });
  });

  it("counts a page under its path alone, an annonce's id kept whole", () => {
    expect(cleanPath("/fr/annonces?q=20123456&gov=Sfax#top")).toBe("/fr/annonces");
    expect(cleanPath("/fr/annonces/177ab97c-e1b7-4938-8272-040146a37c85")).toBe("/fr/annonces/177ab97c-e1b7-4938-8272-040146a37c85");
    expect(cleanPath("/fr/agences/20123456")).toBe("/fr/agences/[phone]");
    expect(cleanPath("")).toBe("/");
    expect(cleanPath(`/fr/${"x".repeat(300)}`)).toHaveLength(200);
  });

  it("knows a uuid", () => {
    expect(isUuid("2eeeed01-2ea2-411b-9279-6a8b36826475")).toBe(true);
    expect(isUuid("MZ-00040")).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});

describe("whether the site's own count may receive events", () => {
  const base = { enabled: true, waitForConsent: false, askConsent: true, consent: null } as const;
  it("never while switched off, nor after a no", () => {
    expect(firstPartyAllowed({ ...base, enabled: false, consent: "granted" })).toBe(false);
    expect(firstPartyAllowed({ ...base, consent: "denied" })).toBe(false);
  });
  it("counts everyone by default, once the visitor's answer is known", () => {
    expect(firstPartyAllowed({ ...base, consent: null })).toBe(true);
    expect(firstPartyAllowed({ ...base, consent: "granted" })).toBe(true);
    expect(firstPartyAllowed({ ...base, consent: "unknown" })).toBeNull();
  });
  it("waits for the yes when the admin asked it to", () => {
    expect(firstPartyAllowed({ ...base, waitForConsent: true, consent: null })).toBeNull();
    expect(firstPartyAllowed({ ...base, waitForConsent: true, consent: "granted" })).toBe(true);
    expect(firstPartyAllowed({ ...base, waitForConsent: true, askConsent: false, consent: null })).toBe(true);
  });
});

describe("the queue in a browser", () => {
  const sent: string[] = [];
  beforeEach(() => {
    resetFirstParty();
    resetImpressions();
    sent.length = 0;
    vi.stubGlobal("window", { location: { pathname: "/fr/annonces/abc" }, addEventListener: () => {}, setTimeout, clearTimeout });
    vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });
    vi.stubGlobal("navigator", { sendBeacon: (_url: string, blob: Blob) => { sent.push(String(blob.size)); return true; } });
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetFirstParty();
  });

  it("holds events until the settings are known, then sends them in one batch", () => {
    trackEvent("listing_view", { deal: "sale" }, { listing: "2eeeed01-2ea2-411b-9279-6a8b36826475" });
    trackEvent("gallery_open", { index: 2 }, { listing: "2eeeed01-2ea2-411b-9279-6a8b36826475" });
    expect(pendingFirstParty()).toHaveLength(2);
    expect(pendingFirstParty()[0]).toMatchObject({ n: "listing_view", p: { deal: "sale" }, path: "/fr/annonces/abc", listing: "2eeeed01-2ea2-411b-9279-6a8b36826475" });
    configureFirstParty({ enabled: true, waitForConsent: false, askConsent: true, consent: null });
    vi.runAllTimers();
    expect(sent).toHaveLength(1);
    expect(pendingFirstParty()).toHaveLength(0);
  });

  it("keeps the same event sent twice within a breath once", () => {
    trackEvent("page_view");
    trackEvent("page_view");
    trackEvent("search", { q: "villa" });
    vi.advanceTimersByTime(500);
    trackEvent("page_view");
    expect(pendingFirstParty().map((e) => e.n)).toEqual(["page_view", "search", "page_view"]);
  });

  it("forgets everything when the count is off or refused", () => {
    trackEvent("search", { q: "villa" });
    configureFirstParty({ enabled: true, waitForConsent: true, askConsent: true, consent: "denied" });
    vi.runAllTimers();
    expect(sent).toHaveLength(0);
    expect(pendingFirstParty()).toHaveLength(0);
  });

  it("sends nothing from the console", () => {
    vi.stubGlobal("window", { location: { pathname: "/fr/admin/analytics" }, addEventListener: () => {}, setTimeout, clearTimeout });
    trackEvent("page_view");
    expect(pendingFirstParty()).toHaveLength(0);
  });

  it("reports each annonce shown once per surface, in one event", () => {
    const a = "2eeeed01-2ea2-411b-9279-6a8b36826475";
    const b = "0873cd5d-7b55-4a25-9985-04c23ceda5c9";
    trackImpressions([a, b, "not-a-uuid"], "home_rail");
    trackImpressions([a, b], "home_rail");
    trackImpressions([a], "catalogue");
    const events = pendingFirstParty();
    expect(events.map((e) => [e.n, e.p.surface, e.p.count])).toEqual([
      ["listing_impression", "home_rail", 2],
      ["listing_impression", "catalogue", 1],
    ]);
    expect(events[0].p.ids).toEqual([a, b]);
  });

  it("shapes a batch with the age of each event and the visitor's id", () => {
    const batch = buildBatch([{ n: "page_view", p: {}, t: 1_000, path: "/fr" }], 3_500, "abcdefghij12");
    expect(batch).toEqual({ cid: "abcdefghij12", events: [{ n: "page_view", p: {}, t: 2_500, path: "/fr" }] });
    expect(buildBatch([], 0, null)).toEqual({ events: [] });
  });
});

describe("the server side", () => {
  it("reads a batch field by field and drops what is odd", () => {
    const { cid, events } = readBatch({
      cid: "abcdefghij12",
      events: [
        { n: "search", p: { q: "villa" }, t: 10, path: "/fr/annonces", listing: 5 },
        { n: "Bad Name", p: {} },
        null,
        { n: "page_view", p: "nope", t: "x" },
      ],
    });
    expect(cid).toBe("abcdefghij12");
    expect(events).toEqual([
      { n: "search", p: { q: "villa" }, t: 10, path: "/fr/annonces", listing: undefined, shop: undefined },
      { n: "page_view", p: {}, t: 0, path: "/", listing: undefined, shop: undefined },
    ]);
    expect(readBatch(null).events).toEqual([]);
    expect(readBatch({ cid: "<script>", events: [] }).cid).toBeNull();
  });

  it("classes a browser string, and names a crawler", () => {
    expect(deviceOf("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1")).toBe("phone");
    expect(deviceOf("Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36")).toBe("phone");
    expect(deviceOf("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1")).toBe("tablet");
    expect(deviceOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36")).toBe("desktop");
    expect(deviceOf("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe("bot");
    expect(deviceOf("facebookexternalhit/1.1")).toBe("bot");
    expect(deviceOf(null)).toBe("unknown");
  });

  it("reads the locale off a path", () => {
    expect(localeOf("/ar/annonces")).toBe("ar");
    expect(localeOf("/fr")).toBe("fr");
    expect(localeOf("/annonces")).toBeNull();
    expect(localeOf(null)).toBeNull();
  });

  it("keys a visitor by day, never by address", () => {
    const k1 = dailyVisitorKey("41.230.1.1", "UA", "2026-11-01", "salt");
    const k2 = dailyVisitorKey("41.230.1.1", "UA", "2026-11-02", "salt");
    expect(k1).toMatch(/^a:[A-Za-z0-9_-]{24}$/);
    expect(k1).not.toBe(k2);
    expect(k1).not.toContain("41.230");
    expect(dailyVisitorKey("41.230.1.1", "UA", "2026-11-01", "salt")).toBe(k1);
  });

  it("turns a batch into rows with the server's facts and the events' timing", () => {
    const rows = rowsFromBatch(
      [
        { n: "search", p: { q: "villa 20 123 456", results: 3 }, t: 2_000, path: "/ar/annonces?q=villa", listing: "x" },
        { n: "listing_view", p: {}, t: 0, path: "/fr/annonces/abc", listing: "2eeeed01-2ea2-411b-9279-6a8b36826475" },
      ],
      { userId: null, visitorKey: "a:k", device: "phone", now: Date.parse("2026-11-01T12:00:00.000Z") },
    );
    expect(rows[0]).toEqual({
      name: "search",
      listing_id: null,
      shop_id: null,
      user_id: null,
      visitor_key: "a:k",
      locale: "ar",
      device: "phone",
      path: "/ar/annonces",
      params: { q: "villa [phone]", results: 3 },
      created_at: "2026-11-01T11:59:58.000Z",
    });
    expect(rows[1].listing_id).toBe("2eeeed01-2ea2-411b-9279-6a8b36826475");
    expect(rows[1].locale).toBe("fr");
  });
});
