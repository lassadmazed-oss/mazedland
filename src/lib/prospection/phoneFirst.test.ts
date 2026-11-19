/**
 * The team calls first (2026-11-16).
 *
 * A WhatsApp is read hours after it is sent, so the team phones the owner, takes
 * the yes by phone, and only then sends a message: not a question any more but
 * the agreement written down, with the terms. A call is not a message sent from
 * the team's number, so it does not count against the daily cap.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const settings = {
  prospect_confirm_ar: "", prospect_confirm_fr: "", prospect_ask_ar: "", prospect_ask_fr: "",
  free_listing_limit: 2,
};
vi.mock("@/lib/settings/server", () => ({ getSettings: async () => settings }));
vi.mock("@/lib/log", () => ({ log: { scope: () => ({ info: () => {}, error: () => {}, warn: () => {} }) } }));
vi.mock("@/lib/ai/server", () => ({ callJson: async () => ({ ok: false, reason: "unavailable" }) }));
vi.mock("@/lib/moderation/server", () => ({ moderationSettings: async () => ({}), publishOrQueue: async () => ({}) }));
vi.mock("@/lib/consents/server", () => ({ recordConsents: async () => {} }));
vi.mock("@/lib/admin/audit", () => ({ audit: async () => {} }));

import { CONFIRM_AR, CONFIRM_FR } from "./templates";
import { CONFIRMATION_SENT, readDraft, shownKind } from "./model";
import { confirmMessage, contactsToday, type LeadRow } from "./server";

const lead = (over: Partial<LeadRow> = {}) =>
  ({
    id: "l1", language: "ar", poster_name: "علي", draft: { deal: "sale", categorySlug: "maisons", governorate: "Sfax", areaSqm: 180, title: "دار" },
    ...over,
  }) as unknown as LeadRow;

beforeEach(() => {
  settings.prospect_confirm_ar = CONFIRM_AR;
  settings.prospect_confirm_fr = CONFIRM_FR;
});

describe("the written confirmation of a phone yes", () => {
  it("fills every hole and links the terms, in Arabic and in French", async () => {
    for (const language of ["ar", "fr"] as const) {
      const text = await confirmMessage(lead({ language }), "https://www.mazed.immo");
      expect(text, language).not.toMatch(/\{\w+\}/);
      expect(text, language).toContain(`https://www.mazed.immo/${language}/terms`);
      expect(text, language).toContain("علي");
    }
  });

  it("uses only the holes the screen fills", () => {
    for (const tpl of [CONFIRM_AR, CONFIRM_FR]) {
      const holes = [...tpl.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      expect(holes.length).toBeGreaterThan(0);
      for (const h of holes) expect(["name", "property", "deal", "terms"]).toContain(h);
    }
  });

  it("writes the agreement down: who they are to the property, the terms, and that they can still say no", () => {
    expect(CONFIRM_AR).toContain("{terms}");
    expect(CONFIRM_AR).toMatch(/المالك ولا الوكيل/);
    expect(CONFIRM_AR).toMatch(/«لا»/);
    expect(CONFIRM_FR).toContain("{terms}");
    expect(CONFIRM_FR).toMatch(/propriétaire ou son mandataire/);
    expect(CONFIRM_FR).toMatch(/« non »/);
  });

  it("a confirmation_sent note reads as its own kind, any other note stays a note", () => {
    expect(shownKind("note", CONFIRMATION_SENT)).toBe("confirmation_sent");
    expect(shownKind("note", "pending_review")).toBe("note");
    expect(shownKind("note", null)).toBe("note");
    expect(shownKind("contacted", CONFIRMATION_SENT)).toBe("contacted");
    expect(readDraft(null)).toBeTruthy();
  });
});

describe("contactsToday", () => {
  it("leaves the phone calls out: the cap is for the messages sent from the team's number", async () => {
    const calls: [string, unknown[]][] = [];
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "or"]) q[m] = (...a: unknown[]) => { calls.push([m, a]); return q; };
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ count: 3 }).then(resolve);
    const admin = { from: () => q } as never;
    expect(await contactsToday(admin, "m1")).toBe(3);
    const or = calls.find(([m]) => m === "or");
    expect(or?.[1][0]).toBe("channel.is.null,channel.neq.call");
  });
});

describe("the lead route", () => {
  const route = fs.readFileSync(path.join(process.cwd(), "src/app/api/admin/prospection/leads/[id]/route.ts"), "utf8");

  it("does not stop a call at the daily cap", () => {
    expect(route).toMatch(/const isCall = body\.channel === "call"/);
    expect(route).toMatch(/if \(!isCall && contactsLeft\(cap, done\) === 0\)/);
  });

  it("records the confirmation only for a lead that said yes, by a channel it can go by", () => {
    const block = route.slice(route.indexOf('action === "confirmation_sent"'));
    expect(block).toMatch(/lead\.status !== "confirmed"/);
    expect(block).toMatch(/"whatsapp" && body\.channel !== "sms" && body\.channel !== "other"/);
    expect(block).toContain("CONFIRMATION_SENT");
  });
});

describe("the team's screens", () => {
  const src = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

  it("start a lead on a call, and offer the call before the message", () => {
    const w = src("src/app/[locale]/admin/prospection/LeadWorkspace.tsx");
    expect(w).toMatch(/useState<Channel>\("call"\)/);
    expect(w).toMatch(/useState<Channel \| "">\("call"\)/);
    expect(w.indexOf('t("work.callFirst")')).toBeGreaterThan(-1);
    expect(w.indexOf('t("work.callFirst")')).toBeLessThan(w.indexOf("value={ask}"));
  });

  it("show the confirmation message only after a yes given by phone", () => {
    const w = src("src/app/[locale]/admin/prospection/LeadWorkspace.tsx");
    expect(w).toMatch(/lead\.status === "confirmed" && lead\.confirmationChannel === "call"/);
  });
});

describe("the settings", () => {
  it("the team publishes past the owner's limit by default, and the two messages ship in the registry", async () => {
    const { SETTINGS: REGISTRY } = await import("@/lib/settings/registry");
    expect(REGISTRY.prospect_team_unlimited).toMatchObject({ type: "bool", default: true });
    expect(REGISTRY.prospect_confirm_ar).toMatchObject({ type: "text", default: CONFIRM_AR });
    expect(REGISTRY.prospect_confirm_fr).toMatchObject({ type: "text", default: CONFIRM_FR });
  });
});
