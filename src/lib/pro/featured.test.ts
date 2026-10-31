import { describe, it, expect } from "vitest";
import { dayKey, orderFeatured } from "./featured";

const SHOPS = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id }));

describe("orderFeatured", () => {
  it("keeps every agence and does not touch the list it is given", () => {
    const copy = [...SHOPS];
    const out = orderFeatured(SHOPS, "2026-11-02:");
    expect(out.map((s) => s.id).sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(SHOPS).toEqual(copy);
  });

  it("is the same all day, whoever asks first", () => {
    expect(orderFeatured(SHOPS, "2026-11-02:")).toEqual(orderFeatured([...SHOPS].reverse(), "2026-11-02:"));
  });

  it("turns from one day to the next, so the first place goes round", () => {
    const firsts = new Set<string>();
    for (let d = 1; d <= 20; d++) firsts.add(orderFeatured(SHOPS, `2026-11-${String(d).padStart(2, "0")}:`)[0].id);
    expect(firsts.size).toBeGreaterThan(2);
  });

  it("can order another place on its own", () => {
    expect(orderFeatured(SHOPS, "2026-11-02:Sfax").map((s) => s.id)).not.toEqual(orderFeatured(SHOPS, "2026-11-02:Tunis").map((s) => s.id));
  });
});

describe("dayKey", () => {
  it("is the UTC day", () => {
    expect(dayKey(new Date("2026-11-02T23:30:00.000Z"))).toBe("2026-11-02");
  });
});
