import { describe, it, expect } from "vitest";
import { ZONE_MAX_POINTS, inZone, parseZone, simplifyPath, zoneBounds, zoneParam, type Zone } from "./zone";

const sfax: Zone = [[34.70, 10.70], [34.70, 10.80], [34.80, 10.80], [34.80, 10.70]];

describe("parseZone / zoneParam", () => {
  it("reads the address form and a body, and writes the address back", () => {
    const param = zoneParam(sfax);
    expect(param).toBe("34.7,10.7;34.7,10.8;34.8,10.8;34.8,10.7");
    expect(parseZone(param)).toEqual(sfax);
    expect(parseZone(sfax)).toEqual(sfax);
  });
  it("refuses too few points, too many, a point that does not read or is not in Tunisia", () => {
    expect(parseZone("34.7,10.7;34.8,10.8")).toBeNull();
    expect(parseZone(Array.from({ length: ZONE_MAX_POINTS + 1 }, (_, i) => [34.7 + i / 1000, 10.7]))).toBeNull();
    expect(parseZone("34.7,10.7;x,10.8;34.8,10.8")).toBeNull();
    expect(parseZone("48.8,2.3;48.9,2.3;48.9,2.4")).toBeNull();
    expect(parseZone(null)).toBeNull();
  });
});

describe("inZone", () => {
  it("knows inside from outside", () => {
    expect(inZone({ lat: 34.74, lng: 10.76 }, sfax)).toBe(true);
    expect(inZone({ lat: 36.8, lng: 10.18 }, sfax)).toBe(false);
    // A concave zone: the notch is outside.
    const u: Zone = [[0 + 34, 0 + 10], [0 + 34, 3 + 10], [3 + 34, 3 + 10], [3 + 34, 2 + 10], [1 + 34, 2 + 10], [1 + 34, 1 + 10], [3 + 34, 1 + 10], [3 + 34, 0 + 10]];
    expect(inZone({ lat: 36, lng: 11.5 }, u)).toBe(false);
    expect(inZone({ lat: 34.5, lng: 11.5 }, u)).toBe(true);
  });
  it("frames the zone", () => {
    expect(zoneBounds(sfax)).toEqual([[10.7, 34.7], [10.8, 34.8]]);
  });
});

describe("simplifyPath", () => {
  it("keeps the corners of a traced square and drops the rest", () => {
    const pts = [];
    for (let i = 0; i <= 100; i++) pts.push({ x: i, y: 0 });
    for (let i = 1; i <= 100; i++) pts.push({ x: 100, y: i });
    for (let i = 99; i >= 0; i--) pts.push({ x: i, y: 100 });
    const out = simplifyPath(pts, 2);
    expect(out).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]);
  });
  it("fits at most the zone's points, however wobbly the line", () => {
    const pts = Array.from({ length: 2000 }, (_, i) => ({ x: Math.cos(i / 100) * 300 + (i % 7), y: Math.sin(i / 100) * 300 + (i % 5) }));
    expect(simplifyPath(pts, 1).length).toBeLessThanOrEqual(ZONE_MAX_POINTS);
  });
});
