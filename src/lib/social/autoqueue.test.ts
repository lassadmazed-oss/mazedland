import { describe, expect, it } from "vitest";
import { autoQueueChannels, channelsToPropose, pickAutoQueue, type AutoQueueCandidate } from "./autoqueue";
import { isFeaturedRequest, type LaneAsk, type SocialChannel } from "./channels";

const c = (id: string, seller: string, photos = 3, channels: SocialChannel[] = ["facebook_mazed"]): AutoQueueCandidate => ({
  id,
  seller_id: seller,
  photos,
  channels,
});
const ids = (list: AutoQueueCandidate[]) => list.map((x) => x.id);
const rules = (over: Partial<Parameters<typeof pickAutoQueue>[1]> = {}) => ({
  covered: new Set(["s1", "s2"]),
  minPhotos: 1,
  room: 20,
  ...over,
});

/** The seller's own ask: no admin, the promotion box's consent. */
const sellerAsk = (status: string, channels: SocialChannel[]): LaneAsk => ({
  status,
  channels,
  initiated_by: null,
  consent_version: "2026-10-social-v1",
});
/** Mazed's: the site's proposal on the CGU alone. */
const siteAsk = (status: string, channels: SocialChannel[] = ["facebook_mazed"]): LaneAsk => ({
  status,
  channels,
  initiated_by: null,
  consent_version: "terms-2026-11-05",
});

describe("autoQueueChannels", () => {
  it("names the channels the switches are on for, in the console's order", () => {
    expect(autoQueueChannels({ mazed: true, page: false, instagram: false })).toEqual(["facebook_mazed"]);
    expect(autoQueueChannels({ mazed: true, page: true, instagram: true })).toEqual(["facebook_mazed", "facebook_page", "instagram"]);
    expect(autoQueueChannels({ mazed: false, page: false, instagram: false })).toEqual([]);
  });
});

describe("channelsToPropose", () => {
  const mazed: SocialChannel[] = ["facebook_mazed"];
  const all: SocialChannel[] = ["facebook_mazed", "facebook_page", "instagram"];

  it("proposes every switched-on channel for an annonce never asked about", () => {
    expect(channelsToPropose(all, [])).toEqual(all);
  });

  it("never asks again once Mazed has asked, whatever the answer was", () => {
    for (const status of ["pending_approval", "scheduled", "published", "rejected", "withdrawn", "cancelled"]) {
      expect(channelsToPropose(mazed, [siteAsk(status)])).toEqual([]);
    }
    const byAdmin: LaneAsk = { status: "published", channels: ["facebook_page"], initiated_by: "admin-id", consent_version: "terms-2026-11-05" };
    expect(channelsToPropose(mazed, [byAdmin])).toEqual([]);
  });

  it("still proposes « Mazed » for an annonce its seller promoted on Mazed Immo's page (the Kerkennah houses, 2026-11-10)", () => {
    expect(channelsToPropose(mazed, [sellerAsk("published", ["facebook_page", "instagram", "facebook_groups"])])).toEqual(mazed);
    expect(channelsToPropose(all, [sellerAsk("pending_approval", ["facebook_page", "instagram"])])).toEqual(mazed);
  });

  it("leaves out a page the seller's ask already has, even one added by hand", () => {
    const withMazed = sellerAsk("published", ["facebook_page", "instagram", "facebook_groups", "facebook_mazed"]);
    expect(channelsToPropose(mazed, [withMazed])).toEqual([]);
  });

  it("does not put back a page the seller took back", () => {
    expect(channelsToPropose(all, [sellerAsk("withdrawn", ["facebook_page", "instagram"])])).toEqual(mazed);
    expect(channelsToPropose(all, [sellerAsk("cancelled", ["instagram"])])).toEqual(["facebook_mazed", "facebook_page"]);
  });

  it("proposes nothing for an annonce an admin refused to promote", () => {
    expect(channelsToPropose(mazed, [sellerAsk("rejected", ["facebook_page"])])).toEqual([]);
  });
});

describe("pickAutoQueue", () => {
  it("proposes the annonces of sellers whose CGU cover it, oldest first", () => {
    expect(ids(pickAutoQueue([c("a", "s1"), c("b", "s2")], rules()))).toEqual(["a", "b"]);
  });

  it("leaves an annonce whose seller has not accepted the CGU", () => {
    expect(ids(pickAutoQueue([c("a", "s9"), c("b", "s1")], rules()))).toEqual(["b"]);
  });

  it("leaves an annonce with nothing left to propose, and keeps the channels left for the others", () => {
    const picked = pickAutoQueue([c("a", "s1", 3, []), c("b", "s1", 3, ["facebook_mazed", "instagram"])], rules());
    expect(picked).toEqual([c("b", "s1", 3, ["facebook_mazed", "instagram"])]);
  });

  it("leaves an annonce with too few photos, and takes them all at 0", () => {
    expect(ids(pickAutoQueue([c("a", "s1", 0), c("b", "s1", 1)], rules()))).toEqual(["b"]);
    expect(ids(pickAutoQueue([c("a", "s1", 0), c("b", "s1", 1)], rules({ minPhotos: 0 })))).toEqual(["a", "b"]);
    expect(ids(pickAutoQueue([c("a", "s1", 2), c("b", "s1", 3)], rules({ minPhotos: 3 })))).toEqual(["b"]);
  });

  it("stops at the room the waiting list has left, and at ten a run", () => {
    expect(ids(pickAutoQueue([c("a", "s1"), c("b", "s1"), c("c", "s1")], rules({ room: 2 })))).toEqual(["a", "b"]);
    expect(pickAutoQueue([c("a", "s1")], rules({ room: 0 }))).toEqual([]);
    const many = Array.from({ length: 30 }, (_, i) => c(`l${i}`, "s1"));
    expect(pickAutoQueue(many, rules({ room: 50 }))).toHaveLength(10);
  });

  it("counts only what it takes against the room, not what it skips", () => {
    expect(ids(pickAutoQueue([c("a", "s9"), c("b", "s1"), c("c", "s1")], rules({ room: 1 })))).toEqual(["b"]);
  });
});

describe("isFeaturedRequest", () => {
  it("is Mazed's proposal when an admin made it, or when the site did on the CGU alone", () => {
    expect(isFeaturedRequest({ initiated_by: "admin-id", consent_version: "terms-2026-11-05" })).toBe(true);
    expect(isFeaturedRequest({ initiated_by: "admin-id", consent_version: "2026-10-social-v1" })).toBe(true);
    expect(isFeaturedRequest({ initiated_by: null, consent_version: "terms-2026-11-05" })).toBe(true);
  });

  it("is the seller's own ask otherwise", () => {
    expect(isFeaturedRequest({ initiated_by: null, consent_version: "2026-10-social-v1" })).toBe(false);
    expect(isFeaturedRequest({ initiated_by: null, consent_version: null })).toBe(false);
    expect(isFeaturedRequest({ initiated_by: null })).toBe(false);
  });
});
