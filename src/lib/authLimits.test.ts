import { describe, expect, it } from "vitest";
import { OTP_COOLDOWN_SECS, OTP_MAX_ATTEMPTS, OTP_MAX_PER_WINDOW, dialCodeAllowed } from "./otpPolicy";
import { clientIp, ipKey, trustedIp } from "./clientIp";
import { redactField, redactMetadata, redactSecrets } from "./activityRedact";
import { LOGIN_PAIR_MAX, LOGIN_PHONE_MAX, loginBlocked, recordLoginFailure } from "./auth/loginFailures";
import { SETTINGS } from "./settings/registry";
import { DIAL_CODES } from "./tunisia";

describe("dialCodeAllowed: a code goes only to a country the forms offer", () => {
  const codes = SETTINGS.otp_dial_codes.default as readonly string[];

  it("the default list is exactly the dial codes of the phone input", () => {
    expect([...codes]).toEqual(DIAL_CODES.map((c) => c.code));
  });

  it("accepts a number under an offered code", () => {
    expect(dialCodeAllowed("+21698124111", codes)).toBe(true);
    expect(dialCodeAllowed("+33612345678", codes)).toBe(true);
    expect(dialCodeAllowed("+12025550123", codes)).toBe(true);
  });

  it("refuses a country that is not offered", () => {
    expect(dialCodeAllowed("+79161234567", codes)).toBe(false); // Russia
    expect(dialCodeAllowed("+2250102030405", codes)).toBe(false);
    expect(dialCodeAllowed("+8613800138000", codes)).toBe(false);
  });

  it("an admin who narrows the list to Tunisia refuses the rest", () => {
    expect(dialCodeAllowed("+33612345678", ["+216"])).toBe(false);
    expect(dialCodeAllowed("+21698124111", ["+216"])).toBe(true);
  });

  it("refuses a bare prefix, and a code in the list that is not one", () => {
    expect(dialCodeAllowed("+216", codes)).toBe(false);
    expect(dialCodeAllowed("+21612", codes)).toBe(false);
    expect(dialCodeAllowed("+21698124111", ["216", "+", "+2160000000"])).toBe(false);
    expect(dialCodeAllowed("+21698124111", [])).toBe(false);
  });

  it("keeps the numbers the route and the SQL function were written with", () => {
    expect(OTP_COOLDOWN_SECS).toBe(60);
    expect(OTP_MAX_PER_WINDOW).toBe(5);
    expect(OTP_MAX_ATTEMPTS).toBe(5);
  });

  it("the daily ceiling is a setting an admin can change", () => {
    expect(SETTINGS.otp_daily_cap.default).toBe(1000);
  });
});

describe("ipKey: an IPv6 client is counted as its /64", () => {
  it("leaves IPv4, an IPv4-mapped address and a non-address as they are", () => {
    expect(ipKey("41.226.12.9")).toBe("41.226.12.9");
    expect(ipKey("::ffff:41.226.12.9")).toBe("::ffff:41.226.12.9");
    expect(ipKey("anonymous")).toBe("anonymous");
  });

  it("gives the same key to every address of one /64", () => {
    const a = ipKey("2a01:e0a:1b2:c3d0:aaaa:bbbb:cccc:dddd");
    const b = ipKey("2a01:0e0a:01b2:c3d0:1:2:3:4");
    const c = ipKey("2A01:E0A:1B2:C3D0::7");
    expect(a).toBe("2a01:e0a:1b2:c3d0::/64");
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("tells two /64s apart, and expands :: before cutting", () => {
    expect(ipKey("2a01:e0a:1b2:c3d1::1")).not.toBe(ipKey("2a01:e0a:1b2:c3d0::1"));
    expect(ipKey("::1")).toBe("0:0:0:0::/64");
    expect(ipKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
  });

  it("returns what it cannot read, untouched", () => {
    expect(ipKey("1:2:3:4:5:6:7:8:9")).toBe("1:2:3:4:5:6:7:8:9");
    expect(ipKey("zz::1")).toBe("zz::1");
    expect(ipKey("1::2::3")).toBe("1::2::3");
  });
});

describe("the request's address", () => {
  const req = (h: Record<string, string>) => ({ headers: new Headers(h) });

  it("trustedIp is the platform's, not the visitor's leftmost x-forwarded-for", () => {
    expect(trustedIp(req({ "x-vercel-forwarded-for": "41.0.0.1, 10.0.0.1", "x-forwarded-for": "6.6.6.6, 41.0.0.1" }))).toBe("41.0.0.1");
    expect(trustedIp(req({ "x-forwarded-for": "6.6.6.6, 41.0.0.9" }))).toBe("41.0.0.9");
    expect(trustedIp(req({}))).toBe("anonymous");
  });

  it("clientIp keeps IPv4 whole and cuts IPv6 to its /64", () => {
    expect(clientIp(req({ "x-real-ip": "41.0.0.1" }))).toBe("41.0.0.1");
    expect(clientIp(req({ "x-real-ip": "2a01:e0a:1b2:c3d0:1:2:3:4" }))).toBe("2a01:e0a:1b2:c3d0::/64");
  });
});

describe("the activity log never keeps a private link's key", () => {
  const TOKEN = "Zk3p9Xv_aB-1234567890abcdefghijklmnopqrstu";

  it("takes the token out of a path, with or without the language", () => {
    expect(redactSecrets(`/fr/gerer/${TOKEN}`)).toBe("/fr/gerer/[token]");
    expect(redactSecrets(`/api/gerer/${TOKEN}`)).toBe("/api/gerer/[token]");
    expect(redactSecrets(`https://www.mazed.immo/ar/gerer/${TOKEN}?x=1#y`)).toBe("https://www.mazed.immo/ar/gerer/[token]?x=1#y");
  });

  it("finds it in a sentence (a client error message, a stack line)", () => {
    expect(redactSecrets(`TypeError at https://www.mazed.immo/fr/gerer/${TOKEN}/page.js:1 (x)`)).toBe(
      "TypeError at https://www.mazed.immo/fr/gerer/[token]/page.js:1 (x)",
    );
  });

  it("leaves every other address alone", () => {
    for (const p of ["/fr/annonces/37147ac2-1a58-4c0d-b035-02e0c4dad884", "/fr/gerer", "/fr/gerer/", "/fr/administration", "/api/health"]) {
      expect(redactSecrets(p)).toBe(p);
    }
  });

  it("redactField keeps null, redactMetadata reaches nested text", () => {
    expect(redactField(null)).toBeNull();
    expect(redactField(undefined)).toBeNull();
    expect(redactField(`/fr/gerer/${TOKEN}`)).toBe("/fr/gerer/[token]");
    expect(
      redactMetadata({ route: `/fr/gerer/${TOKEN}`, n: 3, deep: { url: `/ar/gerer/${TOKEN}` }, list: [`/fr/gerer/${TOKEN}`, 7] }),
    ).toEqual({ route: "/fr/gerer/[token]", n: 3, deep: { url: "/ar/gerer/[token]" }, list: ["/fr/gerer/[token]", 7] });
  });
});

/** A rate_limits table in memory: reads count hits by key; check_rate_limit records one. */
function fakeLimits(seed: Record<string, number> = {}) {
  const hits: Record<string, number> = { ...seed };
  const client = {
    from: () => {
      const q: { key?: string } = {};
      const api = {
        select: () => api,
        eq: (_c: string, v: string) => ((q.key = v), api),
        gte: async () => ({ count: hits[q.key!] ?? 0, error: null }),
      };
      return api;
    },
    rpc: async (_name: string, args: { p_key: string }) => {
      hits[args.p_key] = (hits[args.p_key] ?? 0) + 1;
      return { data: false, error: null };
    },
  };
  return { client: client as unknown as Parameters<typeof loginBlocked>[0], hits };
}

describe("login failures: only wrong guesses count, and an attacker locks themselves first", () => {
  const PHONE = "+21698124111";

  it("is open until the ceiling, then closed for that address on that number", async () => {
    const { client, hits } = fakeLimits();
    for (let i = 0; i < LOGIN_PAIR_MAX - 1; i++) await recordLoginFailure(client, PHONE, "6.6.6.6");
    expect(await loginBlocked(client, PHONE, "6.6.6.6")).toBe(false);
    await recordLoginFailure(client, PHONE, "6.6.6.6");
    expect(await loginBlocked(client, PHONE, "6.6.6.6")).toBe(true);
    expect(hits[`loginfail:${PHONE}:6.6.6.6`]).toBe(LOGIN_PAIR_MAX);
  });

  it("the owner, from another address, is not locked by the attacker's ten guesses", async () => {
    const { client } = fakeLimits();
    for (let i = 0; i < LOGIN_PAIR_MAX; i++) await recordLoginFailure(client, PHONE, "6.6.6.6");
    expect(await loginBlocked(client, PHONE, "6.6.6.6")).toBe(true);
    expect(await loginBlocked(client, PHONE, "41.226.12.9")).toBe(false);
  });

  it("another number is not touched either", async () => {
    const { client } = fakeLimits();
    for (let i = 0; i < LOGIN_PAIR_MAX; i++) await recordLoginFailure(client, PHONE, "6.6.6.6");
    expect(await loginBlocked(client, "+21620000000", "6.6.6.6")).toBe(false);
  });

  it("forty failures from many addresses close the number for everyone", async () => {
    const { client } = fakeLimits();
    for (let i = 0; i < LOGIN_PHONE_MAX; i++) await recordLoginFailure(client, PHONE, `10.0.${i % 250}.${i}`);
    expect(await loginBlocked(client, PHONE, "41.226.12.9")).toBe(true);
  });

  it("a read that fails does not lock anyone out", async () => {
    const broken = {
      from: () => {
        const api = { select: () => api, eq: () => api, gte: async () => ({ count: null, error: new Error("down") }) };
        return api;
      },
      rpc: async () => ({ data: null, error: null }),
    } as unknown as Parameters<typeof loginBlocked>[0];
    expect(await loginBlocked(broken, PHONE, "6.6.6.6")).toBe(false);
  });
});
