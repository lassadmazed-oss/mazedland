import { describe, it, expect } from "vitest";
import {
  GOVERNORATE_CENTER, asPin, blurPoint, circleRing, distanceM, inTunisia, isGoogleMapsUrl, isShortMapsLink, parseLocation,
} from "./location";
import { TUNISIAN_GOVERNORATES } from "@/lib/tunisia";

describe("parseLocation", () => {
  it("reads the place itself before where the screen was centred", () => {
    const url = "https://www.google.com/maps/place/Sfax/@34.7400000,10.7500000,15z/data=!3m1!4b1!4m6!3m5!1s0x1!8m2!3d34.7406!4d10.7603";
    expect(parseLocation(url)).toEqual({ lat: 34.7406, lng: 10.7603 });
  });
  it("reads a shared or searched point", () => {
    expect(parseLocation("https://maps.google.com/?q=36.8065,10.1815")).toEqual({ lat: 36.8065, lng: 10.1815 });
    expect(parseLocation("https://www.google.com/maps/search/?api=1&query=35.8256%2C10.636")).toEqual({ lat: 35.8256, lng: 10.636 });
    expect(parseLocation("https://www.google.com/maps/place/34.7406,10.7603")).toEqual({ lat: 34.7406, lng: 10.7603 });
    expect(parseLocation("https://www.google.com/maps/search/34.74,+10.76?entry=tts")).toEqual({ lat: 34.74, lng: 10.76 });
  });
  it("falls back on the centre of the screen", () => {
    expect(parseLocation("https://www.google.tn/maps/@36.85,10.19,14z")).toEqual({ lat: 36.85, lng: 10.19 });
  });
  it("reads plain coordinates and degrees-minutes-seconds", () => {
    expect(parseLocation("34.7406, 10.7603")).toEqual({ lat: 34.7406, lng: 10.7603 });
    expect(parseLocation("34,7406 ; 10,7603")).toEqual({ lat: 34.7406, lng: 10.7603 });
    expect(parseLocation(`34°44'26.2"N 10°45'37.1"E`)).toEqual({ lat: 34.740611, lng: 10.760306 });
  });
  it("opens a consent page's address", () => {
    const wrapped = "https://consent.google.com/m?continue=" + encodeURIComponent("https://www.google.com/maps/place/x/data=!3d36.8!4d10.18") + "&gl=TN";
    expect(parseLocation(wrapped)).toEqual({ lat: 36.8, lng: 10.18 });
  });
  it("says when the point is not in Tunisia, and null when there is none", () => {
    expect(parseLocation("48.8566, 2.3522")).toEqual({ lat: 48.8566, lng: 2.3522, outside: true });
    expect(parseLocation("villa à Sfax")).toBeNull();
    expect(parseLocation("https://maps.app.goo.gl/AbCdEf12345")).toBeNull();
  });
});

describe("links", () => {
  it("knows a short link, which names no point until followed", () => {
    expect(isShortMapsLink("https://maps.app.goo.gl/AbCdEf12345")).toBe(true);
    expect(isShortMapsLink("https://goo.gl/maps/AbC")).toBe(true);
    expect(isShortMapsLink("https://goo.gl/other")).toBe(false);
    expect(isShortMapsLink("http://maps.app.goo.gl/x")).toBe(false);
  });
  it("follows Google's hosts only", () => {
    expect(isGoogleMapsUrl("https://www.google.com/maps/place/x")).toBe(true);
    expect(isGoogleMapsUrl("https://www.google.com.tn/maps")).toBe(true);
    expect(isGoogleMapsUrl("https://consent.google.com/m?continue=x")).toBe(true);
    expect(isGoogleMapsUrl("https://google.com.evil.example/maps")).toBe(false);
    expect(isGoogleMapsUrl("https://169.254.169.254/")).toBe(false);
    expect(isGoogleMapsUrl("http://www.google.com/maps")).toBe(false);
  });
});

describe("asPin", () => {
  it("takes two numbers in Tunisia, rounded to the column", () => {
    expect(asPin({ lat: 34.74061234, lng: "10.7603" })).toEqual({ lat: 34.740612, lng: 10.7603 });
    expect(asPin({ lat: 48.8, lng: 2.3 })).toBeNull();
    expect(asPin({ lat: "x", lng: 10 })).toBeNull();
    expect(asPin(null)).toBeNull();
  });
});

describe("blurPoint", () => {
  it("stays inside the circle and never on the house", () => {
    const pin = { lat: 34.7406, lng: 10.7603 };
    for (const r of [0, 0.25, 0.5, 0.99]) {
      const p = blurPoint(pin, 500, () => r);
      const d = distanceM(pin, p);
      expect(d).toBeGreaterThanOrEqual(124);
      expect(d).toBeLessThanOrEqual(376);
    }
  });
});

describe("circleRing", () => {
  it("is closed and at the radius", () => {
    const c = { lat: 36.8, lng: 10.18 };
    const ring = circleRing(c, 500, 16);
    expect(ring[0]).toEqual(ring[16]);
    for (const [lng, lat] of ring) expect(Math.abs(distanceM(c, { lat, lng }) - 500)).toBeLessThan(2);
  });
});

describe("GOVERNORATE_CENTER", () => {
  it("has every governorate, in Tunisia", () => {
    for (const g of TUNISIAN_GOVERNORATES) {
      expect(GOVERNORATE_CENTER[g], g).toBeTruthy();
      expect(inTunisia(GOVERNORATE_CENTER[g]), g).toBe(true);
    }
  });
});
