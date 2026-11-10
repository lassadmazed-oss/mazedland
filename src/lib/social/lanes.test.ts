import { describe, expect, it } from "vitest";
import { isOpenRequest, laneRoom, requestLane, type LaneAsk, type SocialChannel } from "./channels";

/** 0215: an annonce's asks run in two lanes, the seller's own and Mazed's. */
const ask = (lane: "seller" | "site" | "admin", status: string, channels: SocialChannel[], id = `${lane}-${status}`) => ({
  id,
  status,
  channels,
  initiated_by: lane === "admin" ? "admin-id" : null,
  consent_version: lane === "seller" ? "2026-10-social-v1" : "terms-2026-11-05",
}) satisfies LaneAsk & { id: string };

const SELLERS: SocialChannel[] = ["facebook_page", "instagram", "facebook_groups"];

describe("requestLane", () => {
  it("puts the seller's own ask in their lane, and an admin's or the site's in Mazed's", () => {
    expect(requestLane(ask("seller", "published", SELLERS))).toBe("seller");
    expect(requestLane(ask("site", "pending_approval", ["facebook_mazed"]))).toBe("featured");
    expect(requestLane(ask("admin", "pending_approval", ["facebook_mazed"]))).toBe("featured");
  });
});

describe("isOpenRequest", () => {
  it("is live until it is refused, cancelled or withdrawn", () => {
    for (const s of ["draft", "pending_approval", "scheduled", "published", "failed"]) expect(isOpenRequest(s)).toBe(true);
    for (const s of ["rejected", "cancelled", "withdrawn"]) expect(isOpenRequest(s)).toBe(false);
  });
});

describe("laneRoom", () => {
  it("leaves everything to the first ask of an annonce", () => {
    expect(laneRoom([], "featured", ["facebook_mazed", "facebook_page"])).toEqual({ taken: null, left: ["facebook_mazed", "facebook_page"] });
  });

  it("lets Mazed ask for « Mazed » beside the seller's own promotion, and only for the pages it does not cover", () => {
    const seller = ask("seller", "published", SELLERS);
    expect(laneRoom([seller], "featured", ["facebook_mazed"])).toEqual({ taken: null, left: ["facebook_mazed"] });
    expect(laneRoom([seller], "featured", ["facebook_mazed", "facebook_page", "instagram"])).toEqual({ taken: null, left: ["facebook_mazed"] });
    expect(laneRoom([seller], "featured", ["facebook_page"]).left).toEqual([]);
  });

  it("lets the seller ask beside Mazed's proposal, without the pages it already has", () => {
    const mazed = ask("site", "pending_approval", ["facebook_mazed"]);
    expect(laneRoom([mazed], "seller", SELLERS)).toEqual({ taken: null, left: SELLERS });
    const onImmo = ask("admin", "published", ["facebook_mazed", "facebook_page"]);
    expect(laneRoom([onImmo], "seller", SELLERS)).toEqual({ taken: null, left: ["instagram", "facebook_groups"] });
  });

  it("keeps one live ask per lane", () => {
    const seller = ask("seller", "scheduled", ["facebook_page"]);
    const mazed = ask("site", "published", ["facebook_mazed"]);
    expect(laneRoom([seller, mazed], "seller", ["instagram"]).taken).toBe(seller);
    expect(laneRoom([seller, mazed], "featured", ["instagram"]).taken).toBe(mazed);
  });

  it("forgets what was refused, cancelled or withdrawn", () => {
    const gone = [ask("seller", "withdrawn", SELLERS), ask("site", "rejected", ["facebook_mazed"]), ask("admin", "cancelled", ["facebook_page"])];
    expect(laneRoom(gone, "featured", ["facebook_mazed", "facebook_page"])).toEqual({ taken: null, left: ["facebook_mazed", "facebook_page"] });
    expect(laneRoom(gone, "seller", SELLERS)).toEqual({ taken: null, left: SELLERS });
  });
});
