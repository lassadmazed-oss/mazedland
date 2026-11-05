import { describe, it, expect } from "vitest";
import { FEATURED_CHANNELS, OFFERED_CHANNELS, UTM_SOURCE, channelFromUtmSource, isApiChannel, isPageChannel, platformOf } from "./channels";
import { SOCIAL_TERMS_SINCE, accountsByChannel, isMazedPage, termsCoverFeaturing, type AccountRow } from "./server";
import { wantedPages } from "./connect";

const MAZED = "1390476427730991";
const IMMO = "1285750384783067";

const account = (over: Partial<AccountRow>): AccountRow => ({
  id: "a",
  platform: "facebook_page",
  external_id: IMMO,
  username: null,
  status: "connected",
  token_expires_at: null,
  ...over,
});

describe("the « Mazed » page (0214)", () => {
  it("is a page channel of its own, posted through a Facebook page", () => {
    expect(isPageChannel("facebook_mazed")).toBe(true);
    expect(isPageChannel("facebook_page")).toBe(true);
    expect(isPageChannel("instagram")).toBe(false);
    expect(isApiChannel("facebook_mazed")).toBe(true);
    expect(isApiChannel("facebook_groups")).toBe(false);
    expect(platformOf("facebook_mazed")).toBe("facebook_page");
  });

  it("is offered to an admin, not to a seller", () => {
    expect(FEATURED_CHANNELS).toContain("facebook_mazed");
    expect(OFFERED_CHANNELS).not.toContain("facebook_mazed");
  });

  it("brings its visits back under its own source", () => {
    expect(UTM_SOURCE.facebook_mazed).not.toBe(UTM_SOURCE.facebook_page);
    expect(channelFromUtmSource(UTM_SOURCE.facebook_mazed)).toBe("facebook_mazed");
    expect(channelFromUtmSource("facebook")).toBe("facebook_page");
  });

  it("knows the page by the setting's id or username", () => {
    expect(isMazedPage({ external_id: MAZED }, MAZED)).toBe(true);
    expect(isMazedPage({ external_id: "1", username: "MazedOnline" }, "mazedonline")).toBe(true);
    expect(isMazedPage({ external_id: IMMO, username: null }, MAZED)).toBe(false);
    expect(isMazedPage({ external_id: MAZED }, "")).toBe(false);
  });

  it("gives each channel its own account, most recent first", () => {
    const rows = [
      account({ id: "mazed", external_id: MAZED }),
      account({ id: "immo-new", external_id: IMMO }),
      account({ id: "ig", platform: "instagram", external_id: "17841" }),
      account({ id: "immo-old", external_id: "999" }),
    ];
    const out = accountsByChannel(rows, MAZED);
    expect(out.facebook_mazed?.id).toBe("mazed");
    expect(out.facebook_page?.id).toBe("immo-new");
    expect(out.instagram?.id).toBe("ig");
  });

  it("leaves a channel empty rather than post on the wrong page", () => {
    expect(accountsByChannel([account({ id: "immo" })], MAZED).facebook_mazed).toBeUndefined();
    expect(accountsByChannel([account({ id: "mazed", external_id: MAZED })], MAZED).facebook_page).toBeUndefined();
  });

  it("skips expired and disconnected accounts", () => {
    const now = Date.parse("2026-11-05T12:00:00Z");
    const rows = [
      account({ id: "expired", external_id: MAZED, token_expires_at: "2026-11-01T00:00:00Z" }),
      account({ id: "off", status: "disconnected" }),
    ];
    expect(accountsByChannel(rows, MAZED, now)).toEqual({});
  });

  it("keeps both pages when connecting, and every page without META_PAGE_ID", () => {
    expect(wantedPages(IMMO, MAZED)).toEqual([IMMO, MAZED]);
    expect(wantedPages(IMMO, "")).toEqual([IMMO]);
    expect(wantedPages(IMMO, IMMO)).toEqual([IMMO]);
    expect(wantedPages(null, MAZED)).toBeNull();
  });
});

describe("putting a seller's annonce forward", () => {
  it("needs the CGU in the version that allows it, or a later one", () => {
    expect(termsCoverFeaturing({ granted: true, version: SOCIAL_TERMS_SINCE })).toBe(true);
    expect(termsCoverFeaturing({ granted: true, version: "2026-12-01" })).toBe(true);
    expect(termsCoverFeaturing({ granted: true, version: "2026-10-31" })).toBe(false);
    expect(termsCoverFeaturing({ granted: true, version: "2026-10" })).toBe(false);
    expect(termsCoverFeaturing({ granted: false, version: SOCIAL_TERMS_SINCE })).toBe(false);
    expect(termsCoverFeaturing(null)).toBe(false);
  });
});
