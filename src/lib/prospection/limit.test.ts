/**
 * The owner's limit, in « Prospection » (2026-11-16).
 *
 * A private owner may have `free_listing_limit` annonces online. A member of
 * the team is told from the first screen when the owner has reached it, and
 * cannot put one more online; the whole-console admin is not held to it. The
 * place is claimed by the same database function as everywhere else, with no
 * count for the admin (takePlaceBeyondLimit).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const settings = { free_listing_limit: 2 };
vi.mock("@/lib/settings/server", () => ({ getSettings: async () => settings }));
vi.mock("@/lib/log", () => ({ log: { scope: () => ({ info: () => {}, error: () => {}, warn: () => {} }) } }));
vi.mock("@/lib/ai/server", () => ({ callJson: async () => ({ ok: false, reason: "unavailable" }) }));
vi.mock("@/lib/moderation/server", () => ({ moderationSettings: async () => ({}), publishOrQueue: async () => ({}) }));
vi.mock("@/lib/consents/server", () => ({ recordConsents: async () => {} }));
vi.mock("@/lib/admin/audit", () => ({ audit: async () => {} }));

const allowance = vi.fn();
vi.mock("@/lib/places/server", async (orig) => ({
  ...(await orig<typeof import("@/lib/places/server")>()),
  accountAllowance: (...a: unknown[]) => allowance(...a),
}));

import { leadWarnings } from "./server";
import { takePlaceBeyondLimit } from "@/lib/places/server";

type Table = Record<string, unknown>;

/** A supabase stand-in: every query resolves to the rows of its table. */
function fakeAdmin(tables: Table, rpc?: (fn: string, args: Record<string, unknown>) => unknown) {
  const from = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "limit", "in"]) q[m] = () => q;
    q.maybeSingle = async () => ({ data: tables[table] ?? null });
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: Array.isArray(tables[table]) ? tables[table] : [], error: null }).then(resolve);
    return q;
  };
  return { from, rpc: async (fn: string, args: Record<string, unknown>) => ({ data: rpc?.(fn, args), error: null }) } as never;
}

beforeEach(() => {
  allowance.mockReset();
  settings.free_listing_limit = 2;
});

describe("leadWarnings — the owner's places", () => {
  const owner = { profiles: { id: "owner-1", full_name: "Ali" } };

  it("says the owner is full when the account holds every place it may", async () => {
    allowance.mockResolvedValue({ kind: "free", used: 2, limit: 2, left: 0 });
    const w = await leadWarnings(fakeAdmin(owner), { phone: "+21620000001", sourceUrl: null });
    expect(w.full).toEqual({ used: 2, limit: 2 });
    expect(allowance).toHaveBeenCalledWith(expect.anything(), "owner-1", 2, undefined);
  });

  it("says nothing while a place is left", async () => {
    allowance.mockResolvedValue({ kind: "free", used: 1, limit: 2, left: 1 });
    expect((await leadWarnings(fakeAdmin(owner), { phone: "+21620000001", sourceUrl: null })).full).toBeNull();
  });

  it("does not count the lead's own annonce, whose place is the one asked for", async () => {
    allowance.mockResolvedValue({ kind: "free", used: 1, limit: 2, left: 1 });
    await leadWarnings(fakeAdmin(owner), { phone: "+21620000001", sourceUrl: null, listingId: "listing-9" });
    expect(allowance).toHaveBeenCalledWith(expect.anything(), "owner-1", 2, "listing-9");
  });

  it("says nothing for a number with no account yet", async () => {
    const w = await leadWarnings(fakeAdmin({}), { phone: "+21620000002", sourceUrl: null });
    expect(w.full).toBeNull();
    expect(allowance).not.toHaveBeenCalled();
  });

  it("follows the setting: the limit read is the site's", async () => {
    settings.free_listing_limit = 5;
    allowance.mockResolvedValue({ kind: "free", used: 5, limit: 5, left: 0 });
    await leadWarnings(fakeAdmin(owner), { phone: "+21620000001", sourceUrl: null });
    expect(allowance).toHaveBeenCalledWith(expect.anything(), "owner-1", 5, undefined);
  });
});

describe("takePlaceBeyondLimit", () => {
  const claim = { from: ["draft"], to: "pending_review" as const };

  it("claims the place with no count at all", async () => {
    const calls: Record<string, unknown>[] = [];
    const admin = fakeAdmin({}, (fn, args) => { calls.push({ fn, ...args }); return "ok"; });
    expect(await takePlaceBeyondLimit(admin, { userId: "u", listingId: "l" }, claim)).toEqual({ ok: true });
    expect(calls).toEqual([
      { fn: "claim_listing_place", p_listing: "l", p_seller: "u", p_from: ["draft"], p_to: "pending_review", p_limit: null, p_shop: null, p_shop_owner: null, p_shop_limit: null },
    ]);
  });

  it("still refuses an annonce an admin took down, or one not in a starting status", async () => {
    expect(await takePlaceBeyondLimit(fakeAdmin({}, () => "taken_down"), { userId: "u", listingId: "l" }, claim)).toEqual({ ok: false, reason: "taken_down" });
    expect(await takePlaceBeyondLimit(fakeAdmin({}, () => "not_submittable"), { userId: "u", listingId: "l" }, claim)).toEqual({ ok: false, reason: "not_submittable" });
  });
});

describe("who is held to the limit", () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

  it("the publish route lifts it for the whole-console admin only", () => {
    const src = read("src/app/api/admin/prospection/leads/[id]/publish/route.ts");
    expect(src).toMatch(/unlimited:\s*gate\.scopes === null/);
  });

  it("only the Prospection publication may claim a place with no count", () => {
    const users: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && read(path.relative(process.cwd(), p)).includes("takePlaceBeyondLimit")) {
          users.push(path.relative(process.cwd(), p).replace(/\\/g, "/"));
        }
      }
    };
    walk(path.join(process.cwd(), "src"));
    expect(users.sort()).toEqual(["src/lib/places/server.ts", "src/lib/prospection/server.ts"]);
  });

  it("publishLead holds a member to the places and lifts them only on `unlimited`", () => {
    const src = read("src/lib/prospection/server.ts");
    expect(src).toMatch(/if \(input\.unlimited\) \{[\s\S]*takePlaceBeyondLimit\([\s\S]*\} else \{[\s\S]*takePlace\(/);
  });
});
