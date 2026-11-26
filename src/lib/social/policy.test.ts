import { describe, it, expect } from "vitest";
import { afterError, instagramCrop } from "./policy";

const NOW = new Date("2026-10-24T10:00:00Z");
const minutesAfter = (d: Date | undefined) => (d ? (d.getTime() - NOW.getTime()) / 60_000 : null);

describe("afterError", () => {
  it("retries Meta's trouble with growing waits, then gives up and tells the admins", () => {
    expect(minutesAfter(afterError("transient", { attempts: 1, max_attempts: 5 }, NOW).runAfter)).toBe(1);
    expect(minutesAfter(afterError("network", { attempts: 2, max_attempts: 5 }, NOW).runAfter)).toBe(5);
    expect(minutesAfter(afterError("network", { attempts: 4, max_attempts: 5 }, NOW).runAfter)).toBe(60);
    const last = afterError("transient", { attempts: 5, max_attempts: 5 }, NOW);
    expect(last.status).toBe("failed");
    expect(last.notifyAdmins).toBe(true);
  });

  it("stops and asks for a reconnection when the token is no good", () => {
    const s = afterError("auth", { attempts: 1, max_attempts: 5 }, NOW);
    expect(s).toMatchObject({ status: "manual_action_required", manualReason: "account_expired", expireAccount: true, notifyAdmins: true });
  });

  it("waits an hour for the quota, and hands over once the attempts are spent", () => {
    expect(minutesAfter(afterError("rate_limit", { attempts: 1, max_attempts: 5 }, NOW).runAfter)).toBe(60);
    expect(afterError("rate_limit", { attempts: 5, max_attempts: 5 }, NOW)).toMatchObject({
      status: "manual_action_required",
      manualReason: "limit_reached",
    });
  });

  it("makes a new container when Instagram's has expired", () => {
    expect(afterError("expired_container", { attempts: 1, max_attempts: 5 }, NOW)).toMatchObject({
      status: "scheduled",
      clearContainer: true,
    });
  });

  it("looks for the post when Facebook calls it a duplicate, instead of posting again", () => {
    expect(afterError("duplicate", { attempts: 2, max_attempts: 5 }, NOW)).toMatchObject({ status: "scheduled", adopt: true });
  });

  it("hands a refused photo to a person", () => {
    expect(afterError("media", { attempts: 1, max_attempts: 5 }, NOW)).toMatchObject({
      status: "manual_action_required",
      manualReason: "media_rejected",
    });
  });

  it("does not retry a request Meta will never accept", () => {
    expect(afterError("permanent", { attempts: 1, max_attempts: 5 }, NOW)).toMatchObject({ status: "failed", notifyAdmins: true });
  });
});

describe("instagramCrop", () => {
  it("leaves a photo inside 4:5 – 1.91:1 alone", () => {
    expect(instagramCrop(1600, 1200)).toBeNull();
    expect(instagramCrop(1080, 1350)).toBeNull();
  });
  it("crops a tall phone photo to 4:5, centred", () => {
    expect(instagramCrop(900, 1600)).toEqual({ left: 0, top: 237, width: 900, height: 1125 });
  });
  it("crops a panorama to 1.91:1, centred", () => {
    expect(instagramCrop(4000, 1000)).toEqual({ left: 1045, top: 0, width: 1910, height: 1000 });
  });
});

describe("nextPostSlot: one post every 20 minutes, 08:00–23:00 Tunis (2026-11-26)", async () => {
  const { nextPostSlot } = await import("./policy");
  const at = (iso: string) => new Date(iso);
  const base = { gapMinutes: 20, startHour: 8, endHour: 23 };

  it("posts now when the last post is far enough and it is daytime", () => {
    // 12:00 UTC = 13:00 Tunis; last post 25 minutes ago.
    expect(nextPostSlot({ ...base, now: at("2026-11-26T12:00:00Z"), lastPostedAt: at("2026-11-26T11:35:00Z") }).toISOString()).toBe("2026-11-26T12:00:00.000Z");
    expect(nextPostSlot({ ...base, now: at("2026-11-26T12:00:00Z"), lastPostedAt: null }).toISOString()).toBe("2026-11-26T12:00:00.000Z");
  });

  it("waits for 20 minutes after the last post", () => {
    expect(nextPostSlot({ ...base, now: at("2026-11-26T12:00:00Z"), lastPostedAt: at("2026-11-26T11:55:00Z") }).toISOString()).toBe("2026-11-26T12:15:00.000Z");
  });

  it("waits for 08:00 Tunis in the morning and for the next morning at night", () => {
    // 05:30 UTC = 06:30 Tunis → 08:00 Tunis = 07:00 UTC the same day.
    expect(nextPostSlot({ ...base, now: at("2026-11-26T05:30:00Z"), lastPostedAt: null }).toISOString()).toBe("2026-11-26T07:00:00.000Z");
    // 22:10 UTC = 23:10 Tunis → the next day's 08:00 Tunis.
    expect(nextPostSlot({ ...base, now: at("2026-11-26T22:10:00Z"), lastPostedAt: null }).toISOString()).toBe("2026-11-27T07:00:00.000Z");
    // 23:30 UTC = 00:30 Tunis on the 27th → 08:00 that day.
    expect(nextPostSlot({ ...base, now: at("2026-11-26T23:30:00Z"), lastPostedAt: null }).toISOString()).toBe("2026-11-27T07:00:00.000Z");
    // The gap pushes past 23:00 Tunis → the next morning.
    expect(nextPostSlot({ ...base, now: at("2026-11-26T21:55:00Z"), lastPostedAt: at("2026-11-26T21:50:00Z") }).toISOString()).toBe("2026-11-27T07:00:00.000Z");
  });

  it("leaves a rule out when it is switched off", () => {
    expect(nextPostSlot({ now: at("2026-11-26T02:00:00Z"), lastPostedAt: at("2026-11-26T01:59:00Z"), gapMinutes: 0, startHour: 0, endHour: 24 }).toISOString()).toBe("2026-11-26T02:00:00.000Z");
  });
});
