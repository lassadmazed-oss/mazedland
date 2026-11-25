import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import fr from "../../../messages/fr.json";
import ar from "../../../messages/ar.json";
import { CONSOLE_ONLY, ROUTE_TEXTS, SERVER_ONLY, clientMessages, publicMessages, type RouteTextsKey } from "./publicMessages";

describe("the texts a public page carries", () => {
  it("leave out the console's namespaces, and only them", () => {
    const kept = Object.keys(publicMessages(fr));
    expect(kept).toContain("publish");
    expect(kept).toContain("apiErrors");
    expect(kept).toContain("nav");
    expect(kept).not.toContain("admin");
    expect(kept).not.toContain("adminListings");
    expect(kept).not.toContain("settingsRegistry");
    expect(CONSOLE_ONLY.test("administration")).toBe(false);
  });

  it("are well under the whole set", () => {
    const all = JSON.stringify(fr).length;
    expect(JSON.stringify(publicMessages(fr)).length).toBeLessThan(all * 0.75);
  });

  it("send every page only what a browser can ask for (2026-11-25), each route adding its own", () => {
    const root = Object.keys(clientMessages(fr));
    expect(root).toContain("nav");
    expect(root).not.toContain("pro");
    expect(root).not.toContain("publish");
    expect(root).not.toContain("sms");
    expect(Object.keys(clientMessages(fr, "pro"))).toEqual(expect.arrayContaining(["nav", "pro", "checkout"]));
    expect(Object.keys(clientMessages(fr, "publish"))).toContain("publish");
    // Roughly half of what every page carried before, in both languages.
    for (const m of [fr, ar]) expect(JSON.stringify(clientMessages(m)).length).toBeLessThan(JSON.stringify(publicMessages(m)).length * 0.6);
  });
});

// ── The guard: no browser component asks for a text its pages do not receive ──

const SRC = path.resolve(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const rel = (p: string) => path.relative(SRC, p).split(path.sep).join("/");

/** The route folders whose layout adds their texts. */
const ROUTE_DIRS: Record<RouteTextsKey, string> = {
  pro: "app/[locale]/pro/",
  account: "app/[locale]/account/",
  publish: "app/[locale]/annonces/nouvelle/",
  demande: "app/[locale]/demandes/nouvelle/",
  payment: "app/[locale]/payment/",
};

/**
 * Shared components that read a route's texts, and the routes they render in.
 * The test checks that everything importing them lives in those routes.
 */
const COMPONENT_ROUTES: Record<string, RouteTextsKey[]> = {
  "components/pro/AgenceRequest.tsx": ["pro"],
  "components/pro/ShopForm.tsx": ["pro"],
  "components/payments/PayeeInstructions.tsx": ["pro", "payment"],
  "components/account/DeleteAccountButton.tsx": ["account"],
  "components/account/SmsNotificationsToggle.tsx": ["account"],
  "components/requests/GuestPhoneStep.tsx": ["demande"],
  // The voice publisher's dictation (« Publier en parlant »).
  "components/listing/useDictation.ts": ["publish"],
};

function namespacesOf(source: string): Set<string> {
  const out = new Set<string>();
  for (const m of source.matchAll(/useTranslations\(\s*["'`]([^"'`]*)["'`]\s*\)/g)) out.add(m[1].split(".")[0]);
  // A translator without a namespace reads « ns.key »: the first segment.
  if (/useTranslations\(\s*\)/.test(source)) for (const m of source.matchAll(/\bt\w*\(\s*["'`]([a-zA-Z]+)\./g)) out.add(m[1]);
  return out;
}

describe("the browser texts guard", () => {
  const files = walk(SRC).filter((f) => !rel(f).startsWith("app/[locale]/admin/"));
  const clientFiles = files.filter((f) => /^\s*["']use client["']/m.test(fs.readFileSync(f, "utf8").slice(0, 300)));
  const routeOnly = new Set<string>(Object.values(ROUTE_TEXTS).flat());

  it("finds no browser component reading a server-only text", () => {
    const bad: string[] = [];
    for (const f of clientFiles) for (const ns of namespacesOf(fs.readFileSync(f, "utf8"))) if (SERVER_ONLY.includes(ns)) bad.push(`${rel(f)} → ${ns}`);
    expect(bad).toEqual([]);
  });

  it("finds every route-only text read where its layout adds it", () => {
    const bad: string[] = [];
    for (const f of clientFiles) {
      const r = rel(f);
      const routes: RouteTextsKey[] =
        COMPONENT_ROUTES[r] ?? (Object.keys(ROUTE_DIRS) as RouteTextsKey[]).filter((k) => r.startsWith(ROUTE_DIRS[k]));
      for (const ns of namespacesOf(fs.readFileSync(f, "utf8"))) {
        if (!routeOnly.has(ns)) continue;
        if (routes.length === 0 || !routes.every((k) => (ROUTE_TEXTS[k] as readonly string[]).includes(ns))) bad.push(`${r} → ${ns}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("finds the shared components above imported only inside their routes", () => {
    const bad: string[] = [];
    for (const [comp, routes] of Object.entries(COMPONENT_ROUTES)) {
      const name = path.basename(comp, ".tsx");
      for (const f of files) {
        const r = rel(f);
        if (r === comp) continue;
        if (!new RegExp(`import[^;]*\\b${name}\\b[^;]*from`).test(fs.readFileSync(f, "utf8"))) continue;
        const inside = routes.some((k) => r.startsWith(ROUTE_DIRS[k])) || COMPONENT_ROUTES[r] !== undefined;
        if (!inside) bad.push(`${name} imported by ${r}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("knows every namespace it names", () => {
    for (const ns of [...SERVER_ONLY, ...routeOnly]) expect(Object.keys(fr), ns).toContain(ns);
  });
});
