import { describe, expect, it } from "vitest";
import { autoQueueChannels, pickAutoQueue, type AutoQueueCandidate } from "./autoqueue";
import { isFeaturedRequest } from "./channels";

const c = (id: string, seller: string, photos = 3): AutoQueueCandidate => ({ id, seller_id: seller, photos });
const rules = (over: Partial<Parameters<typeof pickAutoQueue>[1]> = {}) => ({
  asked: new Set<string>(),
  covered: new Set(["s1", "s2"]),
  minPhotos: 1,
  room: 20,
  ...over,
});

describe("autoQueueChannels", () => {
  it("names the channels the switches are on for, in the console's order", () => {
    expect(autoQueueChannels({ mazed: true, page: false, instagram: false })).toEqual(["facebook_mazed"]);
    expect(autoQueueChannels({ mazed: true, page: true, instagram: true })).toEqual(["facebook_mazed", "facebook_page", "instagram"]);
    expect(autoQueueChannels({ mazed: false, page: false, instagram: false })).toEqual([]);
  });
});

describe("pickAutoQueue", () => {
  it("proposes the annonces of sellers whose CGU cover it, oldest first", () => {
    expect(pickAutoQueue([c("a", "s1"), c("b", "s2")], rules())).toEqual(["a", "b"]);
  });

  it("leaves an annonce whose seller has not accepted the CGU", () => {
    expect(pickAutoQueue([c("a", "s9"), c("b", "s1")], rules())).toEqual(["b"]);
  });

  it("never asks again about an annonce already asked about, whatever the answer was", () => {
    expect(pickAutoQueue([c("a", "s1"), c("b", "s1")], rules({ asked: new Set(["a"]) }))).toEqual(["b"]);
  });

  it("leaves an annonce with too few photos, and takes them all at 0", () => {
    expect(pickAutoQueue([c("a", "s1", 0), c("b", "s1", 1)], rules())).toEqual(["b"]);
    expect(pickAutoQueue([c("a", "s1", 0), c("b", "s1", 1)], rules({ minPhotos: 0 }))).toEqual(["a", "b"]);
    expect(pickAutoQueue([c("a", "s1", 2), c("b", "s1", 3)], rules({ minPhotos: 3 }))).toEqual(["b"]);
  });

  it("stops at the room the waiting list has left, and at ten a run", () => {
    expect(pickAutoQueue([c("a", "s1"), c("b", "s1"), c("c", "s1")], rules({ room: 2 }))).toEqual(["a", "b"]);
    expect(pickAutoQueue([c("a", "s1")], rules({ room: 0 }))).toEqual([]);
    const many = Array.from({ length: 30 }, (_, i) => c(`l${i}`, "s1"));
    expect(pickAutoQueue(many, rules({ room: 50 }))).toHaveLength(10);
  });

  it("counts only what it takes against the room, not what it skips", () => {
    expect(pickAutoQueue([c("a", "s9"), c("b", "s1"), c("c", "s1")], rules({ room: 1 }))).toEqual(["b"]);
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
