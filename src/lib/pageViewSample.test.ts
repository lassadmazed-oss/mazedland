import { describe, it, expect } from "vitest";
import { isConsolePath, pageViewRate } from "./pageViewSample";

const rates = { signedIn: 1, anonymous: 0.1, console: 0.1 };

describe("isConsolePath", () => {
  it("knows the console in every language, with or without more path", () => {
    for (const p of ["/fr/admin", "/ar/admin/annonces", "/fr/admin/prospection/rapport", "/en/admin", "//fr//admin/x", "/FR/ADMIN"]) expect(isConsolePath(p), p).toBe(true);
  });

  it("is not fooled by a path that only starts like it", () => {
    for (const p of ["/fr/administration", "/fr/annonces/admin", "/fr/account", "/admin", "/fr", "/fr/pro/dashboard"]) expect(isConsolePath(p), p).toBe(false);
  });
});

describe("pageViewRate", () => {
  it("keeps a signed-in view whole, except in the console, and an anonymous one at its own rate", () => {
    expect(pageViewRate("/fr/annonces", true, rates)).toBe(1);
    expect(pageViewRate("/fr/admin/annonces", true, rates)).toBe(0.1);
    expect(pageViewRate("/fr/annonces", false, rates)).toBe(0.1);
  });

  it("follows the rates it is given", () => {
    const r = { signedIn: 0.5, anonymous: 0.02, console: 0 };
    expect(pageViewRate("/ar/admin", true, r)).toBe(0);
    expect(pageViewRate("/ar", true, r)).toBe(0.5);
    expect(pageViewRate("/ar", false, r)).toBe(0.02);
  });
});
