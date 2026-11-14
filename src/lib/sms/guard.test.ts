import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ down: false, reads: 0, broken: false }));

vi.mock("@/lib/supabase/admin", () => ({
  getServiceSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            state.reads++;
            if (state.broken) throw new Error("no such table");
            return { data: { state: state.down ? "down" : "ok" } };
          },
        }),
      }),
    }),
  }),
}));

import { forgetSmsVerdict, smsIsDown } from "./gate";
import { sendSms } from "../winsms";

describe("the SMS gate", () => {
  beforeEach(() => {
    state.down = false;
    state.reads = 0;
    state.broken = false;
    forgetSmsVerdict();
  });

  it("reads the verdict and remembers it for a moment", async () => {
    state.down = true;
    expect(await smsIsDown()).toBe(true);
    expect(await smsIsDown()).toBe(true);
    expect(state.reads).toBe(1);
    forgetSmsVerdict();
    state.down = false;
    expect(await smsIsDown()).toBe(false);
    expect(state.reads).toBe(2);
  });

  it("lets the message through when the verdict cannot be read", async () => {
    state.broken = true;
    expect(await smsIsDown()).toBe(false);
  });
});

describe("sendSms while WinSMS is down", () => {
  const sent: string[] = [];
  beforeEach(() => {
    process.env.WINSMS_API_KEY = "test-key";
    sent.length = 0;
    state.down = true;
    state.broken = false;
    forgetSmsVerdict();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      sent.push(String(url));
      return new Response(JSON.stringify({ code: "ok", message: "Successfully Send", reference: null }), { status: 200 });
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.WINSMS_API_KEY;
  });

  it("refuses at once: nothing is sent, nothing is billed", async () => {
    expect(await sendSms({ to: "+21622906937", sms: "hello" })).toEqual({ ok: false, error: "provider_down" });
    expect(sent).toEqual([]);
  });

  it("lets the health job's own probe through", async () => {
    expect(await sendSms({ to: "21600000001", sms: "diag", skipGate: true })).toMatchObject({ ok: true });
    expect(sent).toHaveLength(1);
  });

  it("sends as usual once the verdict is up", async () => {
    state.down = false;
    forgetSmsVerdict();
    expect(await sendSms({ to: "+21622906937", sms: "hello" })).toMatchObject({ ok: true });
    expect(sent).toHaveLength(1);
  });
});
