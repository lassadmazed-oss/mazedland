import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

vi.mock("@/lib/log", () => ({ log: { scope: () => ({ info: () => {}, error: () => {}, warn: () => {} }) } }));

import { runSocialJob, checkSocialAccount, type JobRow } from "./engine";
import { openTiktokTokens, sealTiktokTokens, tiktokAccessToken } from "./tiktokConnect";
import type { Fetch } from "./meta";

// ── A database stand-in ──────────────────────────────────────────────────
// Enough of supabase-js for the engine: select / update / insert / upsert /
// delete with eq, in, is, gte filters, maybeSingle / single, counts, and rpc.

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

function fakeDb(tables: Record<string, Row[]>) {
  const rpcs: { fn: string; args: Row }[] = [];
  let seq = 0;
  const table = (name: string) => (tables[name] ??= []);

  const from = (name: string) => {
    const filters: Filter[] = [];
    let op: "select" | "update" | "insert" | "upsert" | "delete" = "select";
    let values: Row | Row[] = {};
    let count = false;
    let returning = false;
    let conflict: string[] = [];

    const exec = () => {
      const rows = table(name);
      const hit = () => rows.filter((r) => filters.every((f) => f(r)));
      if (op === "select") {
        const data = hit().map((r) => ({ ...r }));
        return { data, count: count ? data.length : null, error: null };
      }
      if (op === "update") {
        const targets = hit();
        for (const r of targets) for (const [k, v] of Object.entries(values as Row)) if (v !== undefined) r[k] = v;
        return { data: returning ? targets.map((r) => ({ ...r })) : null, error: null };
      }
      if (op === "delete") {
        const gone = new Set(hit());
        tables[name] = rows.filter((r) => !gone.has(r));
        return { data: null, error: null };
      }
      const list = Array.isArray(values) ? values : [values];
      const out: Row[] = [];
      for (const v of list) {
        const same = op === "upsert" && conflict.length ? rows.find((r) => conflict.every((k) => r[k] === v[k])) : undefined;
        if (same) {
          Object.assign(same, v);
          out.push({ ...same });
        } else {
          const row = { id: `${name}-${++seq}`, ...v };
          rows.push(row);
          out.push({ ...row });
        }
      }
      return { data: returning ? out : null, error: null };
    };

    const q: Record<string, unknown> = {
      select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
        if (op === "select") count = !!opts?.count;
        else returning = true;
        return q;
      },
      update: (v: Row) => ((op = "update"), (values = v), q),
      insert: (v: Row | Row[]) => ((op = "insert"), (values = v), q),
      upsert: (v: Row | Row[], opts?: { onConflict?: string }) => {
        op = "upsert";
        values = v;
        conflict = (opts?.onConflict ?? "").split(",").filter(Boolean);
        return q;
      },
      delete: () => ((op = "delete"), q),
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
      in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), q),
      is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), q),
      gte: (k: string, v: string) => (filters.push((r) => typeof r[k] === "string" && (r[k] as string) >= v), q),
      order: () => q,
      limit: () => q,
      maybeSingle: async () => {
        const r = exec();
        const data = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data;
        return { data, error: null };
      },
      single: async () => {
        const r = exec();
        return { data: Array.isArray(r.data) ? r.data[0] : r.data, error: null };
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(exec()).then(resolve, reject),
    };
    return q;
  };
  const admin = {
    from,
    rpc: async (fn: string, args: Row) => {
      rpcs.push({ fn, args });
      return { data: null, error: null };
    },
  };
  return { admin: admin as never, tables, rpcs };
}

// ── A TikTok stand-in ────────────────────────────────────────────────────

type Answer = { status?: number; json: unknown };
const ok = (data: unknown): Answer => ({ json: { data, error: { code: "ok", message: "", log_id: "L" } } });
const refused = (status: number, code: string): Answer => ({ json: { error: { code, message: code, log_id: "L" } }, status });

function fakeTiktok(routes: Record<string, (body: string, auth: string | undefined) => Answer>) {
  const calls: { path: string; body: string; auth?: string }[] = [];
  const fetch: Fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.host !== "open.tiktokapis.com") throw new Error(`unexpected host ${url.host}`);
    const body = init?.body instanceof URLSearchParams ? init.body.toString() : typeof init?.body === "string" ? init.body : "";
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    calls.push({ path: url.pathname, body, auth });
    const handler = routes[url.pathname];
    if (!handler) return new Response(JSON.stringify({ error: { code: "not_found" } }), { status: 404 });
    const a = handler(body, auth);
    return new Response(JSON.stringify(a.json), { status: a.status ?? 200 });
  };
  return { fetch, calls, paths: () => calls.map((c) => c.path) };
}

// ── The scene: one approved ask on « Mazed » + TikTok, its TikTok job ─────

const KEY = randomBytes(32).toString("base64");
const NOW = Date.now();
const HOUR = 3_600_000;

function tokens(over: Partial<ReturnType<typeof openTiktokTokens>> = {}) {
  return {
    accessToken: "act.old",
    accessExpiresAt: NOW + 2 * HOUR,
    refreshToken: "rft.old",
    refreshExpiresAt: NOW + 100 * 24 * HOUR,
    openId: "open-1",
    scopes: ["user.info.basic", "video.publish", "video.upload"],
    ...over,
  };
}

function scene(opts: { settings?: Record<string, unknown>; job?: Partial<JobRow>; tokens?: ReturnType<typeof tokens>; photos?: string[] } = {}) {
  const job: JobRow = {
    id: "job-1",
    request_id: "req-1",
    channel: "tiktok",
    group_id: null,
    action: "publish",
    account_id: "acc-tt",
    status: "running",
    attempts: 1,
    max_attempts: 5,
    container_id: null,
    external_post_id: null,
    ...opts.job,
  };
  const db = fakeDb({
    app_settings: Object.entries({ social_tiktok_draft: false, social_tiktok_public: false, ...opts.settings }).map(([key, value]) => ({ key, value })),
    social_accounts: [
      {
        id: "acc-tt",
        platform: "tiktok",
        external_id: "open-1",
        username: "mazed613",
        name: "Mazed Immo",
        status: "connected",
        token_sealed: sealTiktokTokens(opts.tokens ?? tokens()),
        token_expires_at: new Date(NOW + 100 * 24 * HOUR).toISOString(),
        last_error: null,
      },
    ],
    social_publication_requests: [
      {
        id: "req-1",
        ref: "1a2b3c",
        status: "scheduled",
        language: "both",
        user_id: "seller-1",
        listing_id: "lst-1",
        listing: { id: "lst-1", status: "published", deal_type: "sale" },
      },
    ],
    social_content_variants: [
      {
        request_id: "req-1",
        channel: "tiktok",
        body: "🏠 للبيع · دار S+3 · صفاقس\n💰 350 000 د.ت\n\n🔗 Photos et détails · التصاور والتفاصيل : www.mazed.immo/p/1A2B3C (lien dans la bio)\nRéf. MZ-1A2B3C\n\n#MazedImmo #صفاقس",
        photo_paths: opts.photos ?? ["lst-1/a.webp", "lst-1/b.webp"],
      },
    ],
    social_publication_jobs: [{ ...job, published_at: null, manual_reason: null, last_error: null }],
    social_publication_results: [],
  });
  const jobRow = () => db.tables.social_publication_jobs.find((j) => j.id === "job-1")!;
  const account = () => db.tables.social_accounts[0];
  return { ...db, job, jobRow, account };
}

const creator = (privacy: string[] = ["SELF_ONLY"]) =>
  ok({ creator_username: "mazed613", creator_nickname: "Mazed Immo", privacy_level_options: privacy, comment_disabled: false });

beforeEach(() => {
  vi.stubEnv("SOCIAL_TOKEN_KEY", KEY);
  vi.stubEnv("TIKTOK_CLIENT_KEY", "ck");
  vi.stubEnv("TIKTOK_CLIENT_SECRET", "cs");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://www.mazed.immo");
});
afterEach(() => vi.unstubAllEnvs());

describe("a TikTok job", () => {
  it("posts the photos from the site's own address, follows the post until it is online, and stores its link", async () => {
    const s = scene({ settings: { social_tiktok_public: true } });
    let looks = 0;
    const t = fakeTiktok({
      "/v2/post/publish/creator_info/query/": () => creator(["PUBLIC_TO_EVERYONE", "SELF_ONLY"]),
      "/v2/post/publish/content/init/": () => ok({ publish_id: "p_pub_1" }),
      "/v2/post/publish/status/fetch/": () =>
        ++looks < 2 ? ok({ status: "PROCESSING_DOWNLOAD" }) : ok({ status: "PUBLISH_COMPLETE", publicaly_available_post_id: ["7436512345678901234"] }),
    });

    expect(await runSocialJob(s.admin, s.job, { fetch: t.fetch, pollMs: 0 })).toBe("published");

    expect(t.paths()).toEqual([
      "/v2/post/publish/creator_info/query/",
      "/v2/post/publish/content/init/",
      "/v2/post/publish/status/fetch/",
      "/v2/post/publish/status/fetch/",
    ]);
    const init = JSON.parse(t.calls[1].body);
    expect(t.calls[1].auth).toBe("Bearer act.old");
    expect(init.media_type).toBe("PHOTO");
    expect(init.post_mode).toBe("DIRECT_POST");
    expect(init.post_info.privacy_level).toBe("PUBLIC_TO_EVERYONE");
    expect(init.post_info.title).toBe("🏠 للبيع · دار S+3 · صفاقس");
    expect(init.post_info.description).toContain("Réf. MZ-1A2B3C");
    expect(init.source_info.photo_images).toEqual([
      "https://www.mazed.immo/api/social/image/req-1/0?c=tiktok",
      "https://www.mazed.immo/api/social/image/req-1/1?c=tiktok",
    ]);

    const j = s.jobRow();
    expect(j.status).toBe("published");
    expect(j.container_id).toBe("p_pub_1");
    expect(j.external_post_id).toBe("7436512345678901234");
    expect(j.external_url).toBe("https://www.tiktok.com/@mazed613/photo/7436512345678901234");
    expect(s.tables.social_publication_requests[0].status).toBe("published");
    // The seller hears it once, on the first channel online.
    expect(s.rpcs.map((r) => r.fn)).toContain("enqueue_notification");
  });

  it("posts « only me » while the public switch is off (all an app TikTok has not audited may do)", async () => {
    const s = scene();
    const t = fakeTiktok({
      "/v2/post/publish/creator_info/query/": () => creator(["PUBLIC_TO_EVERYONE", "SELF_ONLY"]),
      "/v2/post/publish/content/init/": () => ok({ publish_id: "p_pub_1" }),
      "/v2/post/publish/status/fetch/": () => ok({ status: "PUBLISH_COMPLETE", publicaly_available_post_id: [] }),
    });
    expect(await runSocialJob(s.admin, s.job, { fetch: t.fetch, pollMs: 0 })).toBe("published");
    expect(JSON.parse(t.calls[1].body).post_info.privacy_level).toBe("SELF_ONLY");
    // A private post has no public id, and so no link.
    expect(s.jobRow().external_url).toBeNull();
  });

  it("sends a draft to the TikTok app and leaves the rest to a person", async () => {
    const s = scene({ settings: { social_tiktok_draft: true } });
    const t = fakeTiktok({
      "/v2/post/publish/content/init/": () => ok({ publish_id: "p_inbox_1" }),
      "/v2/post/publish/status/fetch/": () => ok({ status: "SEND_TO_USER_INBOX" }),
    });
    expect(await runSocialJob(s.admin, s.job, { fetch: t.fetch, pollMs: 0 })).toBe("manual");
    // No creator_info for a draft: the person chooses everything in the app.
    expect(t.paths()).toEqual(["/v2/post/publish/content/init/", "/v2/post/publish/status/fetch/"]);
    expect(JSON.parse(t.calls[0].body).post_mode).toBe("MEDIA_UPLOAD");
    const j = s.jobRow();
    expect(j.status).toBe("manual_action_required");
    expect(j.manual_reason).toBe("tiktok_draft");
    expect(j.published_at).toBeTruthy();
    expect(s.rpcs.find((r) => r.fn === "_notify_admins")?.args.p_title).toBe("Brouillon TikTok à publier");
  });

  it("follows the post an earlier attempt started instead of starting another", async () => {
    const s = scene({ job: { container_id: "p_pub_9", attempts: 2 } });
    const t = fakeTiktok({
      "/v2/post/publish/status/fetch/": (body) => {
        expect(JSON.parse(body)).toEqual({ publish_id: "p_pub_9" });
        return ok({ status: "PUBLISH_COMPLETE", publicaly_available_post_id: [] });
      },
    });
    expect(await runSocialJob(s.admin, s.job, { fetch: t.fetch, pollMs: 0 })).toBe("adopted");
    expect(t.paths()).toEqual(["/v2/post/publish/status/fetch/"]);
    expect(s.jobRow().status).toBe("published");
    expect(s.tables.social_publication_results.at(-1)?.outcome).toBe("adopted");
  });

  it("looks again on the next run while TikTok is still downloading the photos", async () => {
    const s = scene();
    const t = fakeTiktok({
      "/v2/post/publish/creator_info/query/": () => creator(),
      "/v2/post/publish/content/init/": () => ok({ publish_id: "p_pub_1" }),
      "/v2/post/publish/status/fetch/": () => ok({ status: "PROCESSING_DOWNLOAD" }),
    });
    expect(await runSocialJob(s.admin, s.job, { fetch: t.fetch, pollMs: 0 })).toBe("retry");
    const j = s.jobRow();
    expect(j.status).toBe("scheduled");
    expect(j.container_id).toBe("p_pub_1");
    expect(j.last_error).toBe("tiktok_processing");
    expect(j.attempts).toBe(0);
  });

  it("hands the post to a person when TikTok has not audited the app yet", async () => {
    const s = scene();
    const t = fakeTiktok({
      "/v2/post/publish/creator_info/query/": () => creator(),
      "/v2/post/publish/content/init/": () => refused(403, "unaudited_client_can_only_post_to_private_accounts"),
    });
    expect(await runSocialJob(s.admin, s.job, { fetch: t.fetch, pollMs: 0 })).toBe("manual");
    expect(s.jobRow().manual_reason).toBe("tiktok_unaudited");
    expect(s.jobRow().container_id).toBeNull();
    expect(s.rpcs.some((r) => r.fn === "_notify_admins")).toBe(true);
  });

  it("forgets a post TikTok could not make, and leaves a refused photo to a person", async () => {
    const s = scene();
    const t = fakeTiktok({
      "/v2/post/publish/creator_info/query/": () => creator(),
      "/v2/post/publish/content/init/": () => ok({ publish_id: "p_pub_1" }),
      "/v2/post/publish/status/fetch/": () => ok({ status: "FAILED", fail_reason: "photo_pull_failed" }),
    });
    expect(await runSocialJob(s.admin, s.job, { fetch: t.fetch, pollMs: 0 })).toBe("manual");
    const j = s.jobRow();
    expect(j.container_id).toBeNull();
    expect(j.manual_reason).toBe("media_rejected");
    expect(j.last_error).toContain("photo_pull_failed");
  });

  it("waits an hour once the day's TikTok posts are spent", async () => {
    const s = scene({ settings: { social_tiktok_daily_limit: 3 } });
    // Two posts and a draft in the last 24 hours; one from yesterday does not count.
    for (const [i, status, hoursAgo] of [[1, "published", 1], [2, "published", 5], [3, "manual_action_required", 2], [4, "published", 30]] as const) {
      s.tables.social_publication_jobs.push({
        id: `job-0${i}`, account_id: "acc-tt", channel: "tiktok", action: "publish", status,
        published_at: new Date(NOW - hoursAgo * HOUR).toISOString(),
      });
    }
    const t = fakeTiktok({});
    expect(await runSocialJob(s.admin, s.job, { fetch: t.fetch, pollMs: 0 })).toBe("retry");
    expect(t.calls).toHaveLength(0);
    expect(s.jobRow().last_error).toBe("daily_limit");
  });

  it("leaves « vendu » and take-downs to a person: TikTok's API cannot edit or delete", async () => {
    const s = scene({ job: { action: "mark_closed" } });
    const t = fakeTiktok({});
    expect(await runSocialJob(s.admin, s.job, { fetch: t.fetch })).toBe("manual");
    expect(t.calls).toHaveLength(0);
    expect(s.jobRow().manual_reason).toBe("not_supported");
  });

  it("waits as a task, as Facebook did before its app, while the TikTok keys are missing", async () => {
    vi.stubEnv("TIKTOK_CLIENT_KEY", "");
    // The access token ran out: it would need the app's keys to be refreshed.
    const s = scene({ tokens: tokens({ accessExpiresAt: NOW - 1000 }) });
    const t = fakeTiktok({});
    expect(await runSocialJob(s.admin, s.job, { fetch: t.fetch })).toBe("manual");
    expect(t.calls).toHaveLength(0);
    expect(s.jobRow().manual_reason).toBe("no_account");
  });

  it("asks for a reconnection when TikTok no longer takes the token", async () => {
    const s = scene();
    const t = fakeTiktok({ "/v2/post/publish/creator_info/query/": () => refused(401, "access_token_invalid") });
    expect(await runSocialJob(s.admin, s.job, { fetch: t.fetch })).toBe("manual");
    expect(s.jobRow().manual_reason).toBe("account_expired");
    expect(s.account().status).toBe("expired");
  });
});

describe("the TikTok token", () => {
  it("is refreshed when it has under 10 minutes left, and the NEW refresh token replaces the old", async () => {
    const s = scene({ tokens: tokens({ accessExpiresAt: NOW + 5 * 60_000 }) });
    const t = fakeTiktok({
      "/v2/oauth/token/": (body) => {
        const p = new URLSearchParams(body);
        expect(p.get("grant_type")).toBe("refresh_token");
        expect(p.get("refresh_token")).toBe("rft.old");
        expect(p.get("client_key")).toBe("ck");
        return { json: { access_token: "act.new", expires_in: 7200, refresh_token: "rft.new", refresh_expires_in: 15_552_000, open_id: "open-1", scope: "video.publish" } };
      },
    });
    const got = await tiktokAccessToken(s.admin, "acc-tt", { fetch: t.fetch, now: NOW });
    expect(got).toMatchObject({ ok: true, token: "act.new", refreshed: true });
    const stored = openTiktokTokens(s.account().token_sealed as string);
    expect(stored.accessToken).toBe("act.new");
    expect(stored.refreshToken).toBe("rft.new");
    expect(s.account().token_expires_at).toBe(new Date(NOW + 15_552_000_000).toISOString());
  });

  it("is used as it is while it has time left", async () => {
    const s = scene();
    const t = fakeTiktok({});
    expect(await tiktokAccessToken(s.admin, "acc-tt", { fetch: t.fetch, now: NOW })).toMatchObject({ ok: true, token: "act.old", refreshed: false });
    expect(t.calls).toHaveLength(0);
  });

  it("takes the pair another run has just written instead of losing the connection", async () => {
    const s = scene({ tokens: tokens({ accessExpiresAt: NOW - 1000 }) });
    const t = fakeTiktok({
      "/v2/oauth/token/": () => {
        // Meanwhile another run refreshed with the same old refresh token, which is now dead.
        s.account().token_sealed = sealTiktokTokens(tokens({ accessToken: "act.theirs", refreshToken: "rft.theirs", accessExpiresAt: NOW + 2 * HOUR }));
        return { status: 400, json: { error: "invalid_grant", error_description: "refresh token used", log_id: "L" } };
      },
    });
    expect(await tiktokAccessToken(s.admin, "acc-tt", { fetch: t.fetch, now: NOW })).toMatchObject({ ok: true, token: "act.theirs" });
    expect(s.account().status).toBe("connected");
  });

  it("ends the connection when TikTok refuses the refresh token for good", async () => {
    const s = scene({ tokens: tokens({ accessExpiresAt: NOW - 1000 }) });
    const t = fakeTiktok({ "/v2/oauth/token/": () => ({ status: 400, json: { error: "invalid_grant", error_description: "expired", log_id: "L" } }) });
    expect(await tiktokAccessToken(s.admin, "acc-tt", { fetch: t.fetch, now: NOW })).toEqual({ ok: false, error: "expired" });
    expect(s.account().status).toBe("expired");
  });

  it("ends it too once the refresh token itself has run out (180 days)", async () => {
    const s = scene({ tokens: tokens({ accessExpiresAt: NOW - 1000, refreshExpiresAt: NOW - 1 }) });
    const t = fakeTiktok({});
    expect(await tiktokAccessToken(s.admin, "acc-tt", { fetch: t.fetch, now: NOW })).toEqual({ ok: false, error: "expired" });
    expect(t.calls).toHaveLength(0);
  });

  it("retries later on a network failure, without ending the connection", async () => {
    const s = scene({ tokens: tokens({ accessExpiresAt: NOW - 1000 }) });
    const failing: Fetch = async () => {
      throw new Error("ECONNRESET");
    };
    await expect(tiktokAccessToken(s.admin, "acc-tt", { fetch: failing, now: NOW })).rejects.toMatchObject({ kind: "network" });
    expect(s.account().status).toBe("connected");
  });
});

describe("« Tester la connexion » on TikTok", () => {
  it("reads who the account posts as and how, and posts nothing", async () => {
    const s = scene();
    const t = fakeTiktok({ "/v2/post/publish/creator_info/query/": () => creator(["SELF_ONLY"]) });
    expect(await checkSocialAccount(s.admin, "acc-tt", { fetch: t.fetch })).toEqual({
      ok: true,
      name: "@mazed613",
      quota: null,
      tiktok: { privacy: ["SELF_ONLY"] },
    });
    expect(t.paths()).toEqual(["/v2/post/publish/creator_info/query/"]);
    expect(s.account().last_checked_at).toBeTruthy();
  });
});

describe("approving an ask on « Mazed » and TikTok", () => {
  function pending(accounts: Row[]) {
    return fakeDb({
      app_settings: [],
      social_accounts: accounts,
      social_publication_requests: [
        { id: "req-2", listing_id: "lst-2", channels: ["facebook_mazed", "tiktok"], status: "pending_approval" },
      ],
      social_content_variants: [
        { id: "v-fb", request_id: "req-2", channel: "facebook_mazed", body: "fb" },
        { id: "v-tt", request_id: "req-2", channel: "tiktok", body: "tt" },
      ],
      listings: [
        {
          id: "lst-2", seller_id: "seller-1", status: "published", title: "Villa", deal_type: "sale", price: 1, price_on_request: false,
          governorate: "Sfax", delegation: null, attributes: {}, furnished: null, available_from: null,
          category: { slug: "villas", label_fr: "Villas", label_ar: "فيلات", kind: "residential" },
          photos: [{ storage_path: "lst-2/a.webp", sort_order: 0, is_cover: true }],
        },
      ],
      social_publication_jobs: [],
    });
  }
  const mazedPage = { id: "acc-fb", platform: "facebook_page", external_id: "1390476427730991", username: "mazedonline", status: "connected", token_expires_at: null, connected_at: "2026-11-05" };
  const tiktokAccount = { id: "acc-tt", platform: "tiktok", external_id: "open-1", username: "mazed613", status: "connected", token_expires_at: new Date(NOW + 24 * HOUR).toISOString(), connected_at: "2026-11-15" };

  it("gives TikTok to the engine once the account is connected, and to a person before", async () => {
    const { approveSocialRequest } = await import("./server");
    const before = pending([mazedPage]);
    expect(await approveSocialRequest(before.admin, "req-2", "admin-1")).toEqual({ ok: true, jobs: 2 });
    const tt = before.tables.social_publication_jobs.find((j) => j.channel === "tiktok")!;
    expect(tt).toMatchObject({ status: "manual_action_required", manual_reason: "no_account", account_id: null });

    const after = pending([mazedPage, tiktokAccount]);
    await approveSocialRequest(after.admin, "req-2", "admin-1");
    expect(after.tables.social_publication_jobs.find((j) => j.channel === "tiktok")).toMatchObject({ status: "scheduled", account_id: "acc-tt" });
    expect(after.tables.social_publication_jobs.find((j) => j.channel === "facebook_mazed")).toMatchObject({ status: "scheduled", account_id: "acc-fb" });
  });

  it("posts only the pages left ticked, and drops the others from the ask", async () => {
    const { approveSocialRequest } = await import("./server");
    const db = pending([mazedPage, tiktokAccount]);
    expect(await approveSocialRequest(db.admin, "req-2", "admin-1", null, ["facebook_mazed"])).toEqual({ ok: true, jobs: 1 });
    expect(db.tables.social_publication_requests[0]).toMatchObject({ channels: ["facebook_mazed"], status: "scheduled" });
    expect(db.tables.social_content_variants.map((v) => v.channel)).toEqual(["facebook_mazed"]);
    expect(db.tables.social_publication_jobs.map((j) => j.channel)).toEqual(["facebook_mazed"]);
    expect(await approveSocialRequest(pending([]).admin, "req-2", "admin-1", null, ["instagram"])).toEqual({ ok: false, error: "no_channel" });
  });
});
