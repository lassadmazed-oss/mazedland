import { describe, expect, it } from "vitest";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { accessToken, fetchGa4Data, forgetToken, jwtClaims, parseServiceAccount, shapeReport, signJwt, testGa4 } from "./ga4-data";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
const account = { client_email: "stats@mazed.iam.gserviceaccount.com", private_key: pem, token_uri: "https://oauth2.googleapis.com/token" };

describe("the service account key", () => {
  it("reads the JSON as pasted, or in base64, and unfolds the key's line breaks", () => {
    const json = JSON.stringify({ client_email: account.client_email, private_key: pem.replace(/\n/g, "\\n") });
    expect(parseServiceAccount(json)?.private_key).toBe(pem);
    expect(parseServiceAccount(Buffer.from(json).toString("base64"))?.client_email).toBe(account.client_email);
  });

  it("refuses anything that is not a key file", () => {
    expect(parseServiceAccount(undefined)).toBeNull();
    expect(parseServiceAccount("")).toBeNull();
    expect(parseServiceAccount("{}")).toBeNull();
    expect(parseServiceAccount(JSON.stringify({ client_email: "x@y", private_key: "nope" }))).toBeNull();
  });
});

describe("the JWT", () => {
  it("claims the analytics read scope for an hour", () => {
    const c = jwtClaims(account, 1_700_000_000_000);
    expect(c).toEqual({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/analytics.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
  });

  it("is signed RS256 with the account's key", () => {
    const token = signJwt(account, 1_700_000_000_000);
    const [h, p, s] = token.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(p, "base64url").toString()).iss).toBe(account.client_email);
    const v = createVerify("RSA-SHA256");
    v.update(`${h}.${p}`);
    expect(v.verify(publicKey, Buffer.from(s, "base64url"))).toBe(true);
  });
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("the token exchange", () => {
  it("posts the assertion and keeps the token until it is about to expire", async () => {
    forgetToken();
    const calls: string[] = [];
    const fake = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(String(url));
      expect(String(init?.body)).toContain("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer");
      return json({ access_token: "tok", expires_in: 3600 });
    }) as typeof fetch;
    expect(await accessToken(account, fake, 1_000)).toBe("tok");
    expect(await accessToken(account, fake, 2_000)).toBe("tok");
    expect(calls).toHaveLength(1);
    expect(await accessToken(account, fake, 3_600_000)).toBe("tok");
    expect(calls).toHaveLength(2);
    forgetToken();
  });

  it("says why Google refused", async () => {
    forgetToken();
    const fake = (async () => json({ error: "invalid_grant", error_description: "Invalid JWT Signature." }, 400)) as typeof fetch;
    await expect(accessToken(account, fake)).rejects.toThrow("google_token: Invalid JWT Signature.");
  });
});

describe("a report", () => {
  it("is read as dimension strings and metric numbers", () => {
    expect(shapeReport({ rows: [{ dimensionValues: [{ value: "/fr" }], metricValues: [{ value: "12" }, { value: "x" }] }] })).toEqual([{ dims: ["/fr"], metrics: [12, 0] }]);
    expect(shapeReport({})).toEqual([]);
  });

  it("fetches every section, keeping the ones Google refuses out with their reason", async () => {
    forgetToken();
    const fake = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("oauth2")) return json({ access_token: "tok", expires_in: 3600 });
      const body = JSON.parse(String(init?.body)) as { dimensions?: { name: string }[]; metrics: { name: string }[] };
      const dim = body.dimensions?.[0]?.name;
      if (dim === "customEvent:search_term") return json({ error: { message: "Field customEvent:search_term is not a valid dimension." } }, 400);
      if (!dim) return json({ rows: [{ metricValues: [{ value: "100" }, { value: "60" }, { value: "120" }, { value: "300" }, { value: "80" }, { value: "95.4" }] }] });
      if (dim === "date") return json({ rows: [{ dimensionValues: [{ value: "20261101" }], metricValues: [{ value: "10" }, { value: "12" }, { value: "30" }] }] });
      return json({ rows: [{ dimensionValues: [{ value: "a" }, { value: "b" }], metricValues: [{ value: "5" }, { value: "4" }] }] });
    }) as typeof fetch;
    const data = await fetchGa4Data(
      { propertyId: "123456", account, from: new Date("2026-10-25T23:00:00Z"), to: new Date("2026-11-01T15:00:00Z"), prevFrom: new Date("2026-10-18T23:00:00Z"), prevTo: new Date("2026-10-25T23:00:00Z") },
      fake,
    );
    expect(data.totals).toEqual({ users: 100, newUsers: 60, sessions: 120, pageViews: 300, engagedSessions: 80, avgSessionSeconds: 95 });
    expect(data.daily).toEqual([{ day: "2026-11-01", users: 10, sessions: 12, pageViews: 30 }]);
    expect(data.sources[0]).toEqual({ source: "a", medium: "b", sessions: 5, users: 4 });
    expect(data.searchTerms).toEqual([]);
    expect(data.errors.searchTerms).toContain("not a valid dimension");
    forgetToken();
  });

  it("tests a connection in one small report", async () => {
    forgetToken();
    const ok = (async (url: string | URL | Request) => (String(url).includes("oauth2") ? json({ access_token: "tok", expires_in: 3600 }) : json({ rows: [{ metricValues: [{ value: "42" }] }] }))) as typeof fetch;
    expect(await testGa4("123", account, ok)).toEqual({ ok: true, users: 42 });
    forgetToken();
    const bad = (async (url: string | URL | Request) => (String(url).includes("oauth2") ? json({ access_token: "tok", expires_in: 3600 }) : json({ error: { message: "User does not have sufficient permissions for this property." } }, 403))) as typeof fetch;
    expect(await testGa4("123", account, bad)).toEqual({ ok: false, error: "google_report: User does not have sufficient permissions for this property." });
    forgetToken();
  });
});
