import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanSearchTerm,
  dropPending,
  flushPending,
  gaAllowed,
  gaIdOrNull,
  gaInitScript,
  isConsolePath,
  track,
} from "./ga";
import { checkSetting, readSetting } from "@/lib/settings/define";
import { SETTINGS } from "@/lib/settings/registry";

describe("the measurement ID", () => {
  it("takes a GA4 ID, in capitals, and nothing else", () => {
    expect(gaIdOrNull("G-AB12CD34EF")).toBe("G-AB12CD34EF");
    expect(gaIdOrNull(" g-ab12cd34ef ")).toBe("G-AB12CD34EF");
    for (const bad of ["", null, undefined, "UA-12345-1", "GTM-ABCD12", "G-", "G-AB12<script>", "AB12CD34EF"]) {
      expect(gaIdOrNull(bad), String(bad)).toBeNull();
    }
  });

  it("is checked by the console the same way, and can be cleared", () => {
    const def = SETTINGS.analytics_ga_id;
    expect(checkSetting(def, "g-ab12cd34ef")).toEqual({ ok: true, value: "G-AB12CD34EF" });
    expect(checkSetting(def, "")).toEqual({ ok: true, value: "" });
    expect(checkSetting(def, "UA-12345-1")).toEqual({ ok: false, error: "invalid_format" });
    // A bad value stored somehow reads as no ID: nothing loads.
    expect(readSetting(def, "<script>")).toBe("");
  });
});

describe("whether Google loads", () => {
  const on = { enabled: true, id: "G-AB12CD34EF" };
  it("never while switched off or without an ID", () => {
    expect(gaAllowed({ ...on, enabled: false, askConsent: false, consent: "granted" })).toBe(false);
    expect(gaAllowed({ ...on, id: null, askConsent: false, consent: "granted" })).toBe(false);
  });

  it("only after a yes when visitors are asked", () => {
    expect(gaAllowed({ ...on, askConsent: true, consent: null })).toBe(false);
    expect(gaAllowed({ ...on, askConsent: true, consent: "denied" })).toBe(false);
    expect(gaAllowed({ ...on, askConsent: true, consent: "granted" })).toBe(true);
  });

  it("for everyone but a no when they are not", () => {
    expect(gaAllowed({ ...on, askConsent: false, consent: null })).toBe(true);
    expect(gaAllowed({ ...on, askConsent: false, consent: "denied" })).toBe(false);
  });
});

describe("the console", () => {
  it("is every /admin path, with or without the language", () => {
    for (const p of ["/fr/admin", "/ar/admin/settings", "/FR/Admin/x", "/admin", "/fr/%61dmin/annonces"]) {
      expect(isConsolePath(p), p).toBe(true);
    }
    for (const p of ["/fr", "/ar/annonces", "/fr/annonces/admin", "/fr/administration", "/"]) {
      expect(isConsolePath(p), p).toBe(false);
    }
  });
});

const ORIGIN = "https://www.mazed.immo";

/** Runs the inline script against a stand-in window, history, location and document. */
function runInit(start: string, referrer = "") {
  const reload = vi.fn();
  const location = {
    origin: ORIGIN,
    href: ORIGIN + start,
    pathname: new URL(ORIGIN + start).pathname,
    reload,
  };
  const go = (url: string) => {
    const u = new URL(url, location.href);
    location.href = u.href;
    location.pathname = u.pathname;
  };
  const win: Record<string, unknown> = { dataLayer: [] as unknown[] };
  const listeners: Record<string, () => void> = {};
  const history = {
    pushState(_s: unknown, _t: string, url: string) {
      go(url);
    },
    replaceState(_s: unknown, _t: string, url: string) {
      go(url);
    },
  };
  const addEventListener = (type: string, fn: () => void) => {
    listeners[type] = fn;
  };
  new Function("window", "location", "history", "addEventListener", "dataLayer", "document", gaInitScript("G-TEST1234"))(
    win,
    location,
    history,
    addEventListener,
    win.dataLayer,
    { referrer },
  );
  const off = () => win["ga-disable-G-TEST1234"];
  const config = () => (win.dataLayer as IArguments[]).map((a) => Array.from(a)).find((c) => c[0] === "config")?.[2];
  return { win, location, history, listeners, off, reload, go, config };
}

describe("the script before gtag.js", () => {
  it("refuses advertising and Google Signals", () => {
    const { win, config } = runInit("/fr");
    const calls = (win.dataLayer as IArguments[]).map((a) => Array.from(a));
    expect(calls[0]).toEqual([
      "consent",
      "default",
      { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "granted" },
    ]);
    expect(calls.at(-1)?.[0]).toBe("config");
    // A clean address and no referrer: nothing overridden.
    expect(config()).toEqual({ allow_google_signals: false, allow_ad_personalization_signals: false });
  });

  it("switches Google off inside the navigation into the console", () => {
    const { history, off, reload } = runInit("/fr/annonces");
    expect(off()).toBe(false);
    history.pushState(null, "", "/ar/annonces/abc?q=villa");
    expect(off()).toBe(false);
    history.pushState(null, "", "/fr/admin/settings");
    expect(off()).toBe(true);
    history.replaceState(null, "", "/fr/admin/annonces");
    expect(off()).toBe(true);
    expect(reload).not.toHaveBeenCalled();

    // Back button into the console.
    const back = runInit("/fr/annonces");
    back.go("/fr/admin");
    back.listeners.popstate();
    expect(back.off()).toBe(true);
  });

  it("reloads a page leaving the console, Google staying off until it goes", () => {
    const { win, history, off, reload } = runInit("/fr");
    history.pushState(null, "", "/fr/admin/vendeurs?q=20123456");
    history.pushState(null, "", "/fr/annonces");
    expect(reload).toHaveBeenCalledTimes(1);
    expect(off()).toBe(true);
    // The loader re-applying its state must not switch it back on.
    (win.__mazedGaSync as () => void)();
    expect(off()).toBe(true);
  });

  it("reloads on the back button out of the console too", () => {
    const { history, listeners, go, off, reload } = runInit("/fr");
    history.pushState(null, "", "/fr/admin");
    go("/fr");
    listeners.popstate();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(off()).toBe(true);
  });

  it("keeps a no given after Google loaded through later navigations", () => {
    const { win, history, off } = runInit("/fr");
    win.__mazedGaOff = true;
    history.pushState(null, "", "/fr/annonces");
    expect(off()).toBe(true);
  });

  it("sends the first page cleaned of the console, phone numbers and e-mails", () => {
    expect(runInit("/fr/annonces?q=villa%2020%20123%20456&cat=villas").config()).toMatchObject({
      page_location: `${ORIGIN}/fr/annonces?q=villa%20%5Bphone%5D&cat=villas`,
    });
    expect(runInit("/fr", `${ORIGIN}/fr/admin/vendeurs?q=20123456`).config()).toMatchObject({ page_referrer: `${ORIGIN}/` });
    expect(runInit("/fr", `${ORIGIN}/fr/annonces?q=ali%40gmail.com`).config()).toMatchObject({
      page_referrer: `${ORIGIN}/fr/annonces?q=%5Bemail%5D`,
    });
    // Another site's address, or a clean one of ours, is left to Google.
    expect(runInit("/fr", "https://www.facebook.com/").config()).not.toHaveProperty("page_referrer");
    expect(runInit("/fr/annonces?q=villa", `${ORIGIN}/fr`).config()).toEqual({
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
  });
});

describe("what a search sends", () => {
  it("keeps the words and prices, not a phone number or an e-mail", () => {
    expect(cleanSearchTerm("  villa   S+3 sfax ")).toBe("villa S+3 sfax");
    expect(cleanSearchTerm("appartement 450 000 dt")).toBe("appartement 450 000 dt");
    expect(cleanSearchTerm("terrain 1 200 000")).toBe("terrain 1 200 000");
    expect(cleanSearchTerm("villa 20 123 456")).toBe("villa [phone]");
    expect(cleanSearchTerm("+216 20123456 maison")).toBe("[phone] maison");
    expect(cleanSearchTerm("contact ali.ben@gmail.com")).toBe("contact [email]");
    expect(cleanSearchTerm(null)).toBe("");
    expect(cleanSearchTerm("a".repeat(300))).toHaveLength(100);
  });
});

describe("track", () => {
  afterEach(() => {
    dropPending();
    vi.unstubAllGlobals();
  });

  it("hands the event to gtag, without empty values", () => {
    const gtag = vi.fn();
    vi.stubGlobal("window", { location: { pathname: "/fr/annonces/x" }, gtag });
    track("phone_reveal", { listing_id: "x", empty: "", none: undefined });
    expect(gtag).toHaveBeenCalledWith("event", "phone_reveal", { listing_id: "x" });
  });

  it("sends nothing from the console", () => {
    const gtag = vi.fn();
    vi.stubGlobal("window", { location: { pathname: "/fr/admin/annonces" }, gtag });
    track("share", { method: "copy" });
    expect(gtag).not.toHaveBeenCalled();
  });

  it("keeps what comes before gtag until it is ready — or forgets it", () => {
    const win: { location: { pathname: string }; gtag?: (...a: unknown[]) => void } = { location: { pathname: "/fr/annonces" } };
    vi.stubGlobal("window", win);
    track("search", { search_term: "villa" });
    win.gtag = vi.fn();
    flushPending();
    expect(win.gtag).toHaveBeenCalledWith("event", "search", { search_term: "villa" });

    // Not ready yet when the next one comes: the earlier event still goes first.
    delete win.gtag;
    track("phone_reveal", { listing_id: "a" });
    const inOrder = vi.fn();
    win.gtag = inOrder;
    track("contact_call", { listing_id: "a" });
    expect(inOrder.mock.calls.map((c) => c[1])).toEqual(["phone_reveal", "contact_call"]);

    const later = vi.fn();
    delete win.gtag;
    track("search", { search_term: "maison" });
    dropPending();
    win.gtag = later;
    flushPending();
    expect(later).not.toHaveBeenCalled();
  });
});
