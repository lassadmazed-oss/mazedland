import { describe, expect, it } from "vitest";
import { installContext } from "./context";
import { guidePlan, mayShowOpenBrowser, safariMajor, withOpenedFlag, withoutOpenedFlag } from "./guide";

const UA = {
  fbAndroid: "Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/490.0.0.0;]",
  igIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 360.0.0",
  safari26: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1",
  safari17: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  chromeIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1",
  chromeAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36",
  samsung: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0 Mobile Safari/537.36",
  desktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
};

const plan = (ua: string, promptReady = false) => guidePlan(installContext(ua), { promptReady, safariMajor: safariMajor(ua) });
const scenes = (p: ReturnType<typeof plan>) => ("steps" in p ? p.steps.map((s) => s.scene) : []);

describe("the install guide's plan (2026-11-25)", () => {
  it("asks the people inside Facebook / Instagram to open their browser first", () => {
    const a = plan(UA.fbAndroid, true);
    expect(a).toMatchObject({ mode: "open-browser", primary: "open-chrome", copy: false });
    expect(scenes(a)).toEqual(["inapp-android-bar", "inapp-android-menu"]);
    const i = plan(UA.igIphone);
    expect(i).toMatchObject({ mode: "open-browser", primary: null, copy: true });
    expect(scenes(i)).toEqual(["inapp-ios-bar", "inapp-ios-menu"]);
  });

  it("tells iOS 26 Safari from older ones by Safari's own version", () => {
    expect(safariMajor(UA.safari26)).toBe(26);
    expect(safariMajor(UA.chromeIos)).toBeNull();
    const n = plan(UA.safari26);
    expect(scenes(n)).toEqual(["safari-bar", "safari-menu", "ios-share-sheet", "ios-add-dialog"]);
    expect(n).toMatchObject({ alt: { label: "older" } });
    const o = plan(UA.safari17);
    expect(scenes(o)).toEqual(["ios-share-bar-old", "ios-share-sheet", "ios-add-dialog"]);
    expect(o).toMatchObject({ alt: { label: "newer" } });
  });

  it("gives Chrome for iPhone its Share button, Android its prompt or its menu", () => {
    expect(scenes(plan(UA.chromeIos))).toEqual(["chrome-ios-bar", "ios-share-sheet", "ios-add-dialog"]);
    expect(plan(UA.chromeAndroid, true)).toMatchObject({ mode: "install", primary: "prompt" });
    expect(scenes(plan(UA.chromeAndroid))).toEqual(["chrome-android-bar", "chrome-android-menu", "android-install-dialog"]);
    expect(scenes(plan(UA.samsung))).toEqual(["samsung-bar", "samsung-menu"]);
    expect(plan(UA.desktop)).toEqual({ mode: "none" });
  });

  it("carries the « opened from the app » flag and takes it back off", () => {
    const u = withOpenedFlag("https://www.mazed.immo/fr/annonces/x?utm_source=facebook");
    expect(u).toBe("https://www.mazed.immo/fr/annonces/x?utm_source=facebook&mz_open=1");
    expect(withoutOpenedFlag(u)).toBe("https://www.mazed.immo/fr/annonces/x?utm_source=facebook");
  });

  it("shows « open in your browser » once a visit and a few times a week", () => {
    const now = Date.UTC(2026, 10, 25, 12);
    const day = 24 * 3600_000;
    expect(mayShowOpenBrowser([], now, 2, false)).toBe(true);
    expect(mayShowOpenBrowser([], now, 2, true)).toBe(false);
    expect(mayShowOpenBrowser([now - 2 * day, now - day], now, 2, false)).toBe(false);
    expect(mayShowOpenBrowser([now - 8 * day, now - day], now, 2, false)).toBe(true);
  });
});
