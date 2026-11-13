/**
 * POST /api/requests/guest decides who gets an account and who is signed in,
 * so each of its answers is pinned here with Supabase mocked: no proof, no
 * account; a number with an account gets the demande and NO session; a new
 * number gets an account, the CGU recorded, a session and the demande; the
 * proof is spent only once the demande is in.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const state = vi.hoisted(() => ({
  settings: { requests_guest_form: true, legal_version: "2026-11-05", requests_max_active: 10, requests_days: 60 } as Record<string, unknown>,
  sms: true,
  proofOk: true,
  verifiedAt: null as string | null,
  profile: null as { id: string } | null,
  currentUser: null as { id: string } | null,
  createError: null as { message: string } | null,
  signInError: null as { message: string } | null,
  insertStatus: 200,
  calls: {
    createUser: [] as unknown[],
    signIn: [] as unknown[],
    insert: [] as { userId: string; extra: Record<string, unknown> }[],
    consents: [] as unknown[],
    otpDeleted: 0,
  },
}));

vi.mock("@/lib/sameOrigin", () => ({ isSameOrigin: () => true }));
vi.mock("@/lib/settings/gate", () => ({ featureOff: async () => null }));
vi.mock("@/lib/settings/server", () => ({ getSettings: async () => state.settings }));
vi.mock("@/lib/winsms", () => ({ isSmsConfigured: () => state.sms }));
vi.mock("@/lib/i18n/server", () => ({ requestLocale: () => "fr" }));
vi.mock("@/lib/analytics/server-events", () => ({ recordServerEvent: () => {} }));
vi.mock("@/lib/consents/server", () => ({
  recordConsents: async (...args: unknown[]) => {
    state.calls.consents.push(args);
    return true;
  },
}));
vi.mock("@/lib/otp", async (orig) => ({
  ...(await orig<typeof import("@/lib/otp")>()),
  verifyPhoneProof: () => state.proofOk,
}));
vi.mock("@/lib/requests/create", () => ({
  readRequestBody: async (_req: unknown, _admin: unknown, body: Record<string, unknown>) =>
    Number(body.budget_max) > 0
      ? { ok: true, value: { deal_type: "sale", governorates: ["Sfax"], budget_max: Number(body.budget_max) } }
      : { ok: false, response: NextResponse.json({ error: "budget_required" }, { status: 400 }) },
  insertRequest: async (_req: unknown, _admin: unknown, user: { id: string }, _value: unknown, _s: unknown, extra: Record<string, unknown> = {}) => {
    state.calls.insert.push({ userId: user.id, extra });
    return state.insertStatus === 200
      ? NextResponse.json({ ok: true, id: "req-1", ...extra })
      : NextResponse.json({ error: "too_many" }, { status: state.insertStatus });
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.currentUser } }),
      signInWithPassword: async (creds: unknown) => {
        state.calls.signIn.push(creds);
        return { error: state.signInError };
      },
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getServiceSupabase: () => {
    const query = (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        delete: () => {
          if (table === "phone_otps") state.calls.otpDeleted++;
          return q;
        },
        maybeSingle: async () => ({
          data: table === "phone_otps" ? (state.verifiedAt ? { verified_at: state.verifiedAt } : null) : state.profile,
        }),
      };
      return q;
    };
    return {
      rpc: async () => ({ data: false }),
      from: query,
      auth: {
        admin: {
          createUser: async (input: unknown) => {
            state.calls.createUser.push(input);
            return state.createError
              ? { data: { user: null }, error: state.createError }
              : { data: { user: { id: "new-user", email: "21698000000@phone.test" } }, error: null };
          },
        },
      },
    };
  },
}));

const { POST } = await import("./route");

const PHONE = "+21698000000";
const post = (body: Record<string, unknown>) =>
  POST(
    new NextRequest("https://www.mazed.immo/api/requests/guest", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "mz_phone_proof=proof" },
      body: JSON.stringify(body),
    }),
  );
const demande = { phone: PHONE, accepted: true, deal_type: "sale", budget_max: 200000, governorates: ["Sfax"] };

beforeEach(() => {
  state.settings.requests_guest_form = true;
  state.sms = true;
  state.proofOk = true;
  state.verifiedAt = new Date().toISOString();
  state.profile = null;
  state.currentUser = null;
  state.createError = null;
  state.signInError = null;
  state.insertStatus = 200;
  state.calls = { createUser: [], signIn: [], insert: [], consents: [], otpDeleted: 0 };
});

describe("POST /api/requests/guest", () => {
  it("makes an account, records the CGU, signs in and saves the demande for a new number", async () => {
    const res = await post(demande);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, id: "req-1", account: "new", signedIn: true });
    expect(state.calls.createUser).toHaveLength(1);
    expect(state.calls.createUser[0]).toMatchObject({
      email_confirm: true,
      user_metadata: { phone: PHONE, governorate: "Sfax", language: "fr" },
    });
    expect(state.calls.consents).toHaveLength(1);
    expect(state.calls.signIn).toHaveLength(1);
    expect(state.calls.insert).toEqual([{ userId: "new-user", extra: { account: "new", signedIn: true } }]);
    // The proof is spent: the row and the cookie.
    expect(state.calls.otpDeleted).toBe(1);
    expect(res.headers.get("set-cookie") ?? "").toMatch(/mz_phone_proof=;/);
  });

  it("saves into the account that holds the number and signs NOBODY in", async () => {
    state.profile = { id: "someone" };
    const res = await post(demande);
    expect(await res.json()).toMatchObject({ ok: true, account: "existing", signedIn: false });
    expect(state.calls.insert).toEqual([{ userId: "someone", extra: { account: "existing", signedIn: false } }]);
    expect(state.calls.createUser).toHaveLength(0);
    expect(state.calls.signIn).toHaveLength(0);
    expect(state.calls.otpDeleted).toBe(1);
  });

  it("refuses without this browser's proof, and makes nothing", async () => {
    state.proofOk = false;
    const res = await post(demande);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "phone_not_verified" });
    expect(state.calls.createUser).toHaveLength(0);
    expect(state.calls.insert).toHaveLength(0);
  });

  it("refuses a verification older than fifteen minutes", async () => {
    state.verifiedAt = new Date(Date.now() - 16 * 60 * 1000).toISOString();
    const res = await post(demande);
    expect(res.status).toBe(403);
    expect(state.calls.insert).toHaveLength(0);
  });

  it("refuses a bad demande before anything about the number", async () => {
    const res = await post({ ...demande, budget_max: 0 });
    expect(res.status).toBe(400);
    expect(state.calls.createUser).toHaveLength(0);
    expect(state.calls.insert).toHaveLength(0);
  });

  it("asks for the CGU answer", async () => {
    const res = await post({ ...demande, accepted: false });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "terms_required" });
    expect(state.calls.createUser).toHaveLength(0);
  });

  it("is closed when the console switched it off, or without SMS", async () => {
    state.settings.requests_guest_form = false;
    expect((await post(demande)).status).toBe(403);
    state.settings.requests_guest_form = true;
    state.sms = false;
    expect((await post(demande)).status).toBe(503);
    expect(state.calls.insert).toHaveLength(0);
  });

  it("keeps the proof when the demande is refused, so a retry needs no new SMS", async () => {
    state.profile = { id: "someone" };
    state.insertStatus = 409;
    const res = await post(demande);
    expect(res.status).toBe(409);
    expect(state.calls.otpDeleted).toBe(0);
  });

  it("does not open an older account whose address is taken without a profile", async () => {
    state.createError = { message: "A user with this email address has already been registered" };
    const res = await post(demande);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "phone_taken" });
    expect(state.calls.signIn).toHaveLength(0);
    expect(state.calls.insert).toHaveLength(0);
  });

  it("saves for the person already signed in, with no number asked", async () => {
    state.currentUser = { id: "me" };
    state.proofOk = false;
    const res = await post({ deal_type: "sale", budget_max: 200000 });
    expect(await res.json()).toMatchObject({ ok: true, account: "signed_in", signedIn: true });
    expect(state.calls.insert).toEqual([{ userId: "me", extra: { account: "signed_in", signedIn: true } }]);
  });

  it("still saves when the sign-in fails, and says the visitor is not signed in", async () => {
    state.signInError = { message: "boom" };
    const res = await post(demande);
    expect(await res.json()).toMatchObject({ ok: true, account: "new", signedIn: false });
  });
});
