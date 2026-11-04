import { describe, it, expect } from "vitest";
import { compactPrice, inBounds, spreadAround, type MapPoint } from "./mapPoints";
import { distanceM } from "./location";

describe("compactPrice", () => {
  it("fits a bubble", () => {
    expect(compactPrice(900, "fr")).toBe("900");
    expect(compactPrice(1500, "fr")).toBe("1 500");
    expect(compactPrice(270_000, "fr")).toBe("270 k");
    expect(compactPrice(1_250_000, "fr")).toBe("1,3 M");
    expect(compactPrice(12_000_000, "fr")).toBe("12 M");
    expect(compactPrice(null, "fr")).toBe("—");
    expect(compactPrice(0, "fr")).toBe("—");
  });
  it("keeps Western digits on /ar", () => {
    expect(compactPrice(270_000, "ar")).toBe("270 k");
    expect(compactPrice(1500, "ar")).toMatch(/^1.500$/);
  });
});

describe("spreadAround", () => {
  const centre = { lat: 34.7406, lng: 10.7603 };
  it("is the same for an id every time, and within the radius", () => {
    expect(spreadAround(centre, "a")).toEqual(spreadAround(centre, "a"));
    for (const id of ["a", "b", "c", "d", "e", "f"]) expect(distanceM(centre, spreadAround(centre, id, 700))).toBeLessThanOrEqual(701);
  });
  it("spreads different ids apart", () => {
    const points = ["1", "2", "3", "4", "5", "6", "7", "8"].map((id) => spreadAround(centre, id));
    expect(new Set(points.map((p) => `${p.lat},${p.lng}`)).size).toBe(8);
  });
});

describe("inBounds", () => {
  it("keeps the points of the frame", () => {
    const p = (id: string, lat: number, lng: number): MapPoint => ({ id, lat, lng, title: id, price: 1, deal: "sale", place: "", photo: null, zone: false });
    const pts = [p("in", 34.74, 10.76), p("out", 36.8, 10.18)];
    expect(inBounds(pts, { south: 34.5, west: 10.5, north: 35, east: 11 }).map((x) => x.id)).toEqual(["in"]);
  });
});
