/**
 * A member of the team works their own leads only.
 *
 * The owner (the whole console) sees every lead and the team's figures; a
 * member given « Prospection » sees what is assigned to them and nothing a
 * colleague pasted, wrote or confirmed (2026-11-14). The rule is `mayWorkLead`;
 * what keeps it true is that every screen and route of a lead opens the lead
 * through `loadOwnLead`, never through `loadLead`, including the ones not
 * written yet — this test reads them.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { mayWorkLead } from "./model";

const ME = "member-1";
const OTHER = "member-2";

describe("mayWorkLead", () => {
  it("lets the whole-console admin open any lead", () => {
    expect(mayWorkLead(null, "owner", { assigned_to: ME })).toBe(true);
    expect(mayWorkLead(null, "owner", { assigned_to: null })).toBe(true);
  });

  it("lets a member open the leads assigned to them", () => {
    expect(mayWorkLead(["prospection"], ME, { assigned_to: ME })).toBe(true);
  });

  it("keeps a colleague's lead, and a lead nobody holds, away from a member", () => {
    expect(mayWorkLead(["prospection"], ME, { assigned_to: OTHER })).toBe(false);
    expect(mayWorkLead(["prospection"], ME, { assigned_to: null })).toBe(false);
  });

  it("applies to a member who has other sections too", () => {
    expect(mayWorkLead(["annonces", "prospection"], ME, { assigned_to: OTHER })).toBe(false);
  });
});

const ROOT = process.cwd();

function files(dir: string, name: RegExp): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p, name) : name.test(e.name) ? [p] : [];
  });
}

describe("every screen and route of a lead", () => {
  const routes = files(path.join(ROOT, "src", "app", "api", "admin", "prospection", "leads", "[id]"), /^route\.ts$/);
  const page = path.join(ROOT, "src", "app", "[locale]", "admin", "prospection", "[id]", "page.tsx");

  it("are found", () => {
    expect(routes.length).toBeGreaterThanOrEqual(7);
  });

  it.each([...routes, page])("%s opens the lead through loadOwnLead", (file) => {
    const src = fs.readFileSync(file, "utf8");
    expect(src).toMatch(/loadOwnLead\(/);
    expect(src).not.toMatch(/\bloadLead\(/);
  });
});
