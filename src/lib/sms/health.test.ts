import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OutboxRow } from "./outbox";

const winsms = vi.hoisted(() => ({
  isSmsConfigured: vi.fn(() => true),
  readOutbox: vi.fn(),
  sendSms: vi.fn(async () => ({ ok: true as const })),
}));
vi.mock("@/lib/winsms", () => winsms);
const owner = vi.hoisted(() => ({ sendOwnerSms: vi.fn(async () => ({ sent: true })) }));
vi.mock("@/lib/prospection/online", () => ({ LEAD_COLUMNS: "id", sendOwnerSms: owner.sendOwnerSms }));
vi.mock("@/lib/siteUrl", () => ({ PRODUCTION_ORIGIN: "https://www.mazed.immo", siteUrl: () => "https://www.mazed.immo" }));
vi.mock("@/lib/log", () => ({ log: { scope: () => ({ info: () => {}, error: () => {}, warn: () => {} }) } }));
vi.mock("./gate", () => ({ forgetSmsVerdict: () => {}, smsIsDown: async () => false }));

import { runSmsHealth } from "./health";

const FATAL = "&lt;b&gt;Fatal error&lt;/b&gt;: Uncaught mysqli_sql_exception: Connection refused in sendsms.php";
const NOW = new Date("2026-11-14T14:00:00Z");
const LISTING = "a584b11f-06a2-44e2-bf2f-742c696e23db";

const row = (id: number, status: string, over: Partial<OutboxRow> = {}): OutboxRow => ({ id, phone: "21622906937", sms: "x", segments: 1, type: "plain", status, ...over });
const ownerSms = `إعلانك تنشر: https://www.mazed.immo/ar/annonces/${LISTING}\nhttps://www.mazed.immo/ar/gerer/tok`;
const notifSms = "Mazed Immo\nVotre annonce\nhttps://www.mazed.immo/fr/annonces/n-1";

type Tables = {
  health: Record<string, unknown>;
  notifications: { rows: unknown[]; count: number };
  profiles: { rows: unknown[] };
  lead: unknown;
};

/** A supabase stand-in: queries answer from the tables, updates and rpcs are recorded. */
function fake(t: Tables) {
  const updates: { table: string; patch: Record<string, unknown> }[] = [];
  const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
  const from = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "not", "in", "order", "limit"]) b[m] = () => b;
    b.maybeSingle = async () => ({ data: table === "sms_health" ? t.health : table === "prospect_leads" ? t.lead : null });
    b.update = (patch: Record<string, unknown>) => {
      updates.push({ table, patch });
      if (table === "sms_health") Object.assign(t.health, patch);
      return { eq: async () => ({ error: null }) };
    };
    b.then = (resolve: (v: unknown) => unknown) => {
      const data = table === "notifications" ? t.notifications.rows : table === "profiles" ? t.profiles.rows : [];
      const count = table === "notifications" ? t.notifications.count : 0;
      return Promise.resolve({ data, count, error: null }).then(resolve);
    };
    return b;
  };
  return { admin: { from, rpc: async (fn: string, args: Record<string, unknown>) => { rpcs.push({ fn, args }); return { error: null }; } } as never, updates, rpcs };
}

const health = (over: Record<string, unknown> = {}) => ({ state: "ok", since: "2026-11-14T00:00:00Z", checked_at: "2026-11-14T13:55:00Z", last_probe_at: null, last_requeue_id: 0, note: null, ...over });
const tables = (over: Partial<Tables> = {}): Tables => ({ health: health(), notifications: { rows: [], count: 1 }, profiles: { rows: [{ id: "u1" }] }, lead: null, ...over });

beforeEach(() => {
  winsms.isSmsConfigured.mockReturnValue(true);
  winsms.readOutbox.mockReset();
  winsms.sendSms.mockClear();
  owner.sendOwnerSms.mockClear();
  owner.sendOwnerSms.mockResolvedValue({ sent: true });
});

describe("runSmsHealth", () => {
  it("does nothing without a WinSMS key", async () => {
    winsms.isSmsConfigured.mockReturnValue(false);
    const { admin } = fake(tables());
    expect(await runSmsHealth(admin, NOW)).toMatchObject({ checked: false, skipped: "sms_not_configured" });
    expect(winsms.readOutbox).not.toHaveBeenCalled();
  });

  it("does not read the big outbox when nothing was sent since the last look", async () => {
    const { admin } = fake(tables({ notifications: { rows: [], count: 0 } }));
    expect(await runSmsHealth(admin, NOW)).toMatchObject({ checked: false, skipped: "nothing_sent" });
    expect(winsms.readOutbox).not.toHaveBeenCalled();
  });

  it("looks anyway once an hour has passed", async () => {
    winsms.readOutbox.mockResolvedValue([row(1, "Success")]);
    const { admin } = fake(tables({ health: health({ checked_at: "2026-11-14T12:00:00Z" }), notifications: { rows: [], count: 0 } }));
    expect(await runSmsHealth(admin, NOW)).toMatchObject({ checked: true, state: "ok" });
  });

  it("keeps its state when the outbox cannot be read", async () => {
    winsms.readOutbox.mockResolvedValue(null);
    const { admin, updates } = fake(tables());
    expect(await runSmsHealth(admin, NOW)).toMatchObject({ checked: false, skipped: "outbox_unreadable", state: "ok" });
    expect(updates).toEqual([]);
  });

  it("goes down when the newest messages all failed, and tells the admins once", async () => {
    winsms.readOutbox.mockResolvedValue([row(1, "Success"), row(2, FATAL), row(3, FATAL), row(4, FATAL)]);
    const t = tables();
    const { admin, rpcs } = fake(t);
    const out = await runSmsHealth(admin, NOW);
    expect(out).toMatchObject({ checked: true, state: "down", transition: "down" });
    expect(t.health).toMatchObject({ state: "down", note: "Connection refused" });
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0].args).toMatchObject({ p_kind: "admin_sms_down", p_payload: { vars: { reason: "Connection refused", at: "15:00" } } });
    // Nothing is sent again while the provider is down.
    expect(owner.sendOwnerSms).not.toHaveBeenCalled();
  });

  it("stays down without a second alert, probing at most every ten minutes", async () => {
    winsms.readOutbox.mockResolvedValue([row(2, FATAL), row(3, FATAL), row(4, FATAL)]);
    const t = tables({ health: health({ state: "down", checked_at: "2026-11-14T13:00:00Z", last_probe_at: "2026-11-14T13:30:00Z" }) });
    const { admin, rpcs } = fake(t);
    const first = await runSmsHealth(admin, NOW, { probeWaitMs: 0 });
    expect(first).toMatchObject({ state: "down", probed: true });
    expect(winsms.sendSms).toHaveBeenCalledTimes(1);
    expect(winsms.sendSms.mock.calls[0]).toEqual([{ to: "21600000001", sms: "diag", skipGate: true }]);
    // Five minutes later: no new probe.
    const second = await runSmsHealth(admin, new Date(NOW.getTime() + 5 * 60_000), { probeWaitMs: 0 });
    expect(second).toMatchObject({ state: "down", probed: false });
    expect(winsms.sendSms).toHaveBeenCalledTimes(1);
    expect(rpcs).toEqual([]);
  });

  it("comes back up when the probe is not a provider failure, and sends again what failed", async () => {
    const failedOwner = row(2, FATAL, { sms: ownerSms, type: "unicode", segments: 4 });
    const failedNotif = row(3, FATAL, { sms: notifSms });
    const failedProbe = row(4, FATAL, { sms: "diag", phone: "21600000001" });
    winsms.readOutbox
      .mockResolvedValueOnce([row(1, "Success"), failedOwner, failedNotif, failedProbe])
      // After the probe: the newest row is the probe's, no longer a provider failure.
      .mockResolvedValueOnce([row(1, "Success"), failedOwner, failedNotif, failedProbe, row(5, "Mobile Error SMS counted", { sms: "diag", phone: "21600000001" })]);
    const lead = { id: "L1", status: "online", listing_id: LISTING, sms_sent_at: "2026-11-14T11:51:00Z" };
    const t = tables({
      health: health({ state: "down", checked_at: "2026-11-14T13:00:00Z", last_probe_at: "2026-11-14T13:00:00Z" }),
      notifications: { rows: [{ id: "n1", link: "/annonces/n-1" }, { id: "n0", link: "/other" }], count: 1 },
      lead,
    });
    const { admin, updates, rpcs } = fake(t);
    const out = await runSmsHealth(admin, NOW, { probeWaitMs: 0 });
    expect(out).toMatchObject({ state: "ok", transition: "up", requeued: { notifications: 1, owners: 1, ignored: 1 } });
    expect(t.health).toMatchObject({ state: "ok", last_requeue_id: 4 });
    // The owner's SMS is sent again at once; the notification goes back to the drain.
    expect(owner.sendOwnerSms).toHaveBeenCalledTimes(1);
    expect(updates).toContainEqual({ table: "prospect_leads", patch: { sms_sent_at: null, sms_error: "provider_down" } });
    expect(updates).toContainEqual({ table: "notifications", patch: { sms_sent_at: null, sms_attempts: 0 } });
    expect(rpcs.map((r) => r.args.p_kind)).toEqual(["admin_sms_up"]);
    expect(rpcs[0].args).toMatchObject({ p_payload: { vars: { count: 2 } } });
  });

  it("sends again an isolated failure without any alert, and only once", async () => {
    const failed = row(2, FATAL, { sms: notifSms });
    winsms.readOutbox.mockResolvedValue([row(1, "Success"), failed, row(3, "Success")]);
    const t = tables({ notifications: { rows: [{ id: "n1", link: "/annonces/n-1" }], count: 1 } });
    const { admin, rpcs } = fake(t);
    expect(await runSmsHealth(admin, NOW)).toMatchObject({ state: "ok", requeued: { notifications: 1 } });
    expect(rpcs).toEqual([]);
    // The same outbox read again: that failure was looked into already.
    const again = await runSmsHealth(admin, NOW);
    expect(again.requeued).toBeUndefined();
  });
});
