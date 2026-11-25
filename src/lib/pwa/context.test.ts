import { describe, it, expect } from "vitest";
import { chromeIntentUrl, fromAd, installContext, installSteps } from "./context";

const UA = {
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1",
  iphoneFacebook: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/530.0.0.30.112;FBBV/123;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/18.6;FBSS/3;FBID/phone;FBLC/fr_FR;FBOP/5]",
  iphoneInstagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 400.0.0.0.0 (iPhone15,2; iOS 18_6; fr_FR)",
  androidChrome: "Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  androidFacebook: "Mozilla/5.0 (Linux; Android 14; SM-A546B Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/490.0.0.0;]",
  androidSamsung: "Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36",
  androidMessenger: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/480.0]",
  desktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

describe("installContext", () => {
  it("knows the phone, the browser and the app a link was opened in", () => {
    expect(installContext(UA.iphoneSafari)).toEqual({ os: "ios", browser: "safari", app: null });
    expect(installContext(UA.iphoneChrome)).toEqual({ os: "ios", browser: "chrome", app: null });
    expect(installContext(UA.iphoneFacebook)).toEqual({ os: "ios", browser: "inapp", app: "facebook" });
    expect(installContext(UA.iphoneInstagram)).toEqual({ os: "ios", browser: "inapp", app: "instagram" });
    expect(installContext(UA.androidChrome)).toEqual({ os: "android", browser: "chrome", app: null });
    expect(installContext(UA.androidFacebook)).toEqual({ os: "android", browser: "inapp", app: "facebook" });
    expect(installContext(UA.androidMessenger)).toMatchObject({ os: "android", app: "messenger" });
    expect(installContext(UA.androidSamsung)).toEqual({ os: "android", browser: "samsung", app: null });
    expect(installContext(UA.desktop).os).toBe("other");
  });

  it("reads an iPad that says it is a Mac by its touch screen", () => {
    const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
    expect(installContext(mac).os).toBe("other");
    expect(installContext(mac, { touchMac: true })).toEqual({ os: "ios", browser: "safari", app: null });
  });
});

describe("fromAd", () => {
  it("recognises a click from an ad or a social post", () => {
    expect(fromAd("?fbclid=IwAR123", UA.androidChrome)).toBe(true);
    expect(fromAd("?gclid=abc", UA.androidChrome)).toBe(true);
    expect(fromAd("?ttclid=x", UA.androidChrome)).toBe(true);
    expect(fromAd("?utm_source=facebook&utm_medium=social", UA.androidChrome)).toBe(true);
    expect(fromAd("?utm_source=newsletter&utm_medium=cpc", UA.androidChrome)).toBe(true);
    expect(fromAd("", UA.iphoneInstagram)).toBe(true);
  });

  it("leaves a plain visit alone", () => {
    expect(fromAd("", UA.androidChrome)).toBe(false);
    expect(fromAd("?cat=villas&utm_source=google&utm_medium=organic", UA.iphoneSafari)).toBe(false);
  });
});

describe("chromeIntentUrl", () => {
  it("opens the same address in Chrome, back to it when Chrome is missing", () => {
    const href = "https://www.mazed.immo/ar/annonces?cat=villas&fbclid=x";
    expect(chromeIntentUrl(href)).toBe(
      `intent://www.mazed.immo/ar/annonces?cat=villas&fbclid=x#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(href)};end`,
    );
  });
});

describe("installSteps", () => {
  it("picks the steps of the phone and the browser", () => {
    expect(installSteps(installContext(UA.iphoneSafari), false)).toBe("ios-safari");
    expect(installSteps(installContext(UA.iphoneChrome), false)).toBe("ios-other");
    expect(installSteps(installContext(UA.iphoneFacebook), false)).toBe("inapp-ios");
    expect(installSteps(installContext(UA.androidFacebook), true)).toBe("inapp-android");
    expect(installSteps(installContext(UA.androidChrome), true)).toBe("android-prompt");
    expect(installSteps(installContext(UA.androidChrome), false)).toBe("android-menu");
    expect(installSteps(installContext(UA.androidSamsung), false)).toBe("android-menu");
    expect(installSteps(installContext(UA.desktop), true)).toBe("none");
  });
});
