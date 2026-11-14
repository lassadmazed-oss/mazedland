import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = { feature_prospection: true, prospect_report: true, prospect_report_hour: 21 };
vi.mock("@/lib/settings/server", () => ({ getSettings: async () => settings }));
vi.mock("@/lib/log", () => ({ log: { scope: () => ({ info: () => {}, error: () => {}, warn: () => {} }) } }));

import { runReport, REPORT_KIND } from "./report";

type Rows = Record<string, unknown[]>;

/** A supabase stand-in: every query resolves to the rows of its table, every rpc is recorded. */
function fakeAdmin(rows: Rows, already: string[] = []) {
  const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
  const from = (table: string) => {
    const q: Record<string, unknown> = {};
    const data = () => (table === "notifications" ? [] : (rows[table] ?? []));
    let count: number | null = null;
    let userId: string | null = null;
    for (const m of ["select", "gte", "lt", "not", "order", "limit", "in", "is"]) q[m] = () => q;
    q.eq = (col: string, v: string) => {
      if (table === "notifications" && col === "user_id") userId = v;
      return q;
    };
    q.then = (resolve: (v: unknown) => unknown) => {
      if (table === "notifications") count = userId && already.includes(userId) ? 1 : 0;
      return Promise.resolve({ data: data(), count, error: null }).then(resolve);
    };
    return q;
  };
  return { admin: { from, rpc: async (fn: string, args: Record<string, unknown>) => { rpcs.push({ fn, args }); return { error: null }; } } as never, rpcs };
}

const owner = { id: "owner", full_name: "Lassad", admin_scopes: null, banned_at: null };
const owner2 = { id: "owner2", full_name: "Other owner", admin_scopes: null, banned_at: null };
const member = { id: "m1", full_name: "Smartimmo", admin_scopes: ["prospection"], banned_at: null };
const idle = { id: "m2", full_name: "Sami", admin_scopes: ["prospection"], banned_at: null };
const moderator = { id: "m3", full_name: "Mod", admin_scopes: ["annonces"], banned_at: null };
const banned = { id: "m4", full_name: "Gone", admin_scopes: ["prospection"], banned_at: "2026-11-01T00:00:00Z" };

const EVENING = new Date("2026-11-14T20:30:00Z"); // 21:30 in Tunisia

const events = [
  { id: "e1", lead_id: "l1", kind: "contacted", channel: "whatsapp", note: null, actor_id: "m1", created_at: "2026-11-14T10:00:00Z" },
  { id: "e2", lead_id: "l1", kind: "contacted", channel: "sms", note: null, actor_id: "m1", created_at: "2026-11-14T10:05:00Z" },
  { id: "e3", lead_id: "l1", kind: "confirmed", channel: "whatsapp", note: "نعم", actor_id: "m1", created_at: "2026-11-14T11:00:00Z" },
];

beforeEach(() => {
  settings.feature_prospection = true;
  settings.prospect_report = true;
  settings.prospect_report_hour = 21;
});

describe("runReport", () => {
  it("does nothing while the feature or the report is off", async () => {
    const { admin, rpcs } = fakeAdmin({ profiles: [owner, member], prospect_events: events });
    settings.feature_prospection = false;
    expect(await runReport(admin, EVENING)).toEqual({ notified: 0, skipped: "feature_off" });
    settings.feature_prospection = true;
    settings.prospect_report = false;
    expect(await runReport(admin, EVENING)).toEqual({ notified: 0, skipped: "report_off" });
    expect(rpcs).toEqual([]);
  });

  it("waits for the chosen hour in Tunisia", async () => {
    const { admin, rpcs } = fakeAdmin({ profiles: [owner, member], prospect_events: events });
    // 19:30 UTC is 20:30 in Tunisia, before 21.
    expect(await runReport(admin, new Date("2026-11-14T19:30:00Z"))).toEqual({ notified: 0, skipped: "too_early" });
    expect(rpcs).toEqual([]);
  });

  it("sends the owner what each member did, the idle member too", async () => {
    const { admin, rpcs } = fakeAdmin({ profiles: [owner, member, idle], prospect_events: events, prospect_leads: [{ id: "l1", draft: null, poster_name: "Amin" }] });
    expect(await runReport(admin, EVENING)).toEqual({ notified: 1 });
    expect(rpcs).toHaveLength(1);
    const call = rpcs[0];
    expect(call.fn).toBe("enqueue_notification");
    expect(call.args.p_user_id).toBe("owner");
    expect(call.args.p_kind).toBe(REPORT_KIND);
    expect(call.args.p_link).toBe("/admin/prospection/rapport?day=2026-11-14");
    expect(call.args.p_body).toContain("14/11");
    expect(call.args.p_body).toContain("Smartimmo 2 · 1 · 0");
    expect(call.args.p_body).toContain("Sami 0 · 0 · 0");
    expect(call.args.p_payload).toEqual({ vars: { day: "14/11", lines: "Smartimmo 2 · 1 · 0 | Sami 0 · 0 · 0" } });
  });

  it("goes to every admin who holds the whole console, never to a member, a moderator or a suspended one", async () => {
    const { admin, rpcs } = fakeAdmin({ profiles: [owner, owner2, member, moderator, banned], prospect_events: events });
    await runReport(admin, EVENING);
    expect(rpcs.map((r) => r.args.p_user_id).sort()).toEqual(["owner", "owner2"]);
  });

  it("lists a moderator or a suspended member as nobody on the team", async () => {
    const { admin, rpcs } = fakeAdmin({ profiles: [owner, moderator, banned], prospect_events: [] });
    expect(await runReport(admin, EVENING)).toEqual({ notified: 0, skipped: "nobody" });
    expect(rpcs).toEqual([]);
  });

  it("never sends twice on the same day", async () => {
    const { admin, rpcs } = fakeAdmin({ profiles: [owner, member], prospect_events: events }, ["owner"]);
    expect(await runReport(admin, EVENING)).toEqual({ notified: 0 });
    expect(rpcs).toEqual([]);
  });
});
