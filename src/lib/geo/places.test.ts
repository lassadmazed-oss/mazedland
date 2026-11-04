import { describe, it, expect } from "vitest";
import { DELEGATIONS } from "@/lib/delegations";
import { TUNISIAN_GOVERNORATES } from "@/lib/tunisia";
import { GOVERNORATE_BOUNDS, delegationCenter, outsideGovernorate } from "./places";
import { GOVERNORATE_CENTER, inTunisia } from "./location";

describe("places", () => {
  it("knows every governorate's bounds, around its chief town", () => {
    for (const g of TUNISIAN_GOVERNORATES) {
      expect(GOVERNORATE_BOUNDS[g], g).toBeTruthy();
      expect(outsideGovernorate(g, GOVERNORATE_CENTER[g]), g).toBe(false);
    }
  });

  it("places every délégation in Tunisia and inside its governorate", () => {
    for (const [g, list] of Object.entries(DELEGATIONS)) {
      for (const [fr] of list) {
        const c = delegationCenter(g, fr);
        expect(c, `${g}|${fr}`).not.toBeNull();
        expect(inTunisia(c!), `${g}|${fr}`).toBe(true);
        expect(outsideGovernorate(g, c!), `${g}|${fr}`).toBe(false);
      }
    }
  });

  it("reads a délégation however it was typed, and nothing else", () => {
    expect(delegationCenter("Sfax", "sakiet ezzit")).toEqual(delegationCenter("Sfax", "Sakiet Ezzit"));
    expect(delegationCenter("Sfax", "Route Teniour")).toBeNull();
    expect(delegationCenter("Sfax", null)).toBeNull();
  });

  it("says when a pin is in another governorate", () => {
    expect(outsideGovernorate("Sfax", GOVERNORATE_CENTER.Tunis)).toBe(true);
    expect(outsideGovernorate("Tunis", GOVERNORATE_CENTER.Sfax)).toBe(true);
    expect(outsideGovernorate(null, GOVERNORATE_CENTER.Sfax)).toBe(false);
  });
});
