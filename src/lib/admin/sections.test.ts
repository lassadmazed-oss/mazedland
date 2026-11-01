import { describe, expect, it } from "vitest";
import {
  ADMIN_SECTIONS,
  ROLE_PRESETS,
  canOpen,
  cleanScopes,
  presetOf,
  scopesFromRow,
} from "./sections";

describe("canOpen", () => {
  it("opens everything to a full admin, the owner's sections included", () => {
    for (const s of ADMIN_SECTIONS) expect(canOpen(null, s)).toBe(true);
    expect(canOpen(null, "settings")).toBe(true);
    expect(canOpen(null, "equipe")).toBe(true);
  });

  it("opens only the given sections to a member", () => {
    const finance = ROLE_PRESETS.finance;
    expect(canOpen(finance, "paiements")).toBe(true);
    expect(canOpen(finance, "annonces")).toBe(false);
  });

  it("never opens the settings or the team to a member, whatever their list", () => {
    expect(canOpen([...ADMIN_SECTIONS], "settings")).toBe(false);
    expect(canOpen([...ADMIN_SECTIONS], "equipe")).toBe(false);
  });

  it("lets any member through where no section is asked (the dashboard)", () => {
    expect(canOpen([], undefined)).toBe(true);
  });

  it("has the guides as a section of their own (0208), handed out with the content preset", () => {
    expect(ADMIN_SECTIONS).toContain("content");
    expect(ROLE_PRESETS.content).toContain("content");
    expect(canOpen(["content"], "content")).toBe(true);
    expect(canOpen(["annonces", "paiements"], "content")).toBe(false);
    expect(canOpen(ROLE_PRESETS.finance, "content")).toBe(false);
  });
});

describe("the statistics section", () => {
  it("is a section of its own, given to no preset by itself", () => {
    expect(ADMIN_SECTIONS).toContain("analytics");
    expect(canOpen(["analytics"], "analytics")).toBe(true);
    expect(canOpen(ROLE_PRESETS.finance, "analytics")).toBe(false);
    expect(canOpen(ROLE_PRESETS.moderation, "analytics")).toBe(false);
  });
});

describe("cleanScopes", () => {
  it("keeps known sections once, in the console's order", () => {
    expect(cleanScopes(["paiements", "annonces", "paiements", "nope", 3])).toEqual(["annonces", "paiements"]);
  });

  it("refuses an empty list and anything that is not a list", () => {
    expect(cleanScopes([])).toBeNull();
    expect(cleanScopes(["settings", "equipe"])).toBeNull();
    expect(cleanScopes("annonces")).toBeNull();
    expect(cleanScopes(null)).toBeNull();
  });
});

describe("presetOf", () => {
  it("names a full admin and each preset, whatever the order", () => {
    expect(presetOf(null)).toBe("full");
    expect(presetOf([...ROLE_PRESETS.finance].reverse())).toBe("finance");
    expect(presetOf(ROLE_PRESETS.moderation)).toBe("moderation");
  });

  it("calls anything else custom", () => {
    expect(presetOf(["annonces"])).toBe("custom");
  });
});

describe("scopesFromRow", () => {
  it("reads null as the whole console", () => {
    expect(scopesFromRow(null)).toBeNull();
    expect(scopesFromRow(undefined)).toBeNull();
  });

  it("reads a list with nothing known in it as nothing, not everything", () => {
    expect(scopesFromRow(["gone"])).toEqual([]);
  });
});
