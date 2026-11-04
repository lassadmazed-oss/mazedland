import { afterEach, describe, it, expect, vi } from "vitest";
import { pinColumns, pinUpdate, resolveMapsLink } from "./server";

const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });

afterEach(() => vi.unstubAllGlobals());

describe("resolveMapsLink", () => {
  it("follows a short link through Google's redirects to the place", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(redirect("https://www.google.com/maps/place/Villa/data=!4m2!3m1!1s0x0?entry=tts"))
      .mockResolvedValueOnce(redirect("https://www.google.com/maps/place/Villa/@34.7,10.7,15z/data=!3d34.7406!4d10.7603"));
    vi.stubGlobal("fetch", fetch);
    expect(await resolveMapsLink("https://maps.app.goo.gl/AbCdEf12345")).toEqual({ lat: 34.7406, lng: 10.7603 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reads the point a last page writes in", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(redirect("https://www.google.com/maps/place/Villa"))
      .mockResolvedValueOnce(new Response(`<meta content="https://maps.google.com/maps/api/staticmap?center=36.8065%2C10.1815&amp;zoom=15">`, { status: 200 })));
    expect(await resolveMapsLink("https://maps.app.goo.gl/x")).toEqual({ lat: 36.8065, lng: 10.1815 });
  });

  it("never follows a redirect off Google's hosts", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(redirect("http://169.254.169.254/latest/meta-data"));
    vi.stubGlobal("fetch", fetch);
    expect(await resolveMapsLink("https://maps.app.goo.gl/x")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("fetches nothing for a text that is not a short link", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await resolveMapsLink("https://example.com/maps")).toBeNull();
    expect(await resolveMapsLink("34.74, 10.76")).toEqual({ lat: 34.74, lng: 10.76 });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("pinColumns / pinUpdate", () => {
  const pin = { lat: 34.7406, lng: 10.7603 };
  it("shows the pin itself only when exact", () => {
    expect(pinColumns(pin, true, 500)).toEqual({ pin_lat: 34.7406, pin_lng: 10.7603, lat: 34.7406, lng: 10.7603, location_exact: true });
    const approx = pinColumns(pin, false, 500);
    expect(approx.pin_lat).toBe(34.7406);
    expect(approx.lat).not.toBe(34.7406);
    expect(pinColumns(null, false, 500)).toEqual({ pin_lat: null, pin_lng: null, lat: null, lng: null, location_exact: false });
  });
  it("keeps the point already drawn when nothing changed", () => {
    expect(pinUpdate({ pin_lat: "34.740600", pin_lng: "10.760300", location_exact: false }, pin, false, 500)).toBeNull();
    expect(pinUpdate({ pin_lat: null, pin_lng: null, location_exact: false }, null, false, 500)).toBeNull();
    expect(pinUpdate({ pin_lat: "34.740600", pin_lng: "10.760300", location_exact: false }, pin, true, 500)).toMatchObject({ location_exact: true, lat: 34.7406 });
  });
});
