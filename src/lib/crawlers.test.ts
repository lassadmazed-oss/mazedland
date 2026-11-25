import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { BLOCKED_CRAWLERS, doorVerdict, isBlockedCrawler, LIMITED_CRAWLERS, limitedCrawler } from "./crawlers";
import robots from "@/app/robots";

/** The User-Agents seen in the page-view log on 2026-11-13/14. */
const SEEN_AND_BLOCKED = [
  "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.4; +https://openai.com/gptbot)",
  "Mozilla/5.0 (compatible; ElevenlabsCrawler/1.0; +https://elevenlabs.io/docs/bots)",
  "Mozilla/5.0 (compatible; SERankingBacklinksBot/1.0; +https://seranking.com/backlinks-crawler)",
  "Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)",
  "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
  // Seen in the page-view log on 2026-11-18…25, ~7 000 visits a day.
  "Mozilla/5.0 (compatible; Reflectionbot/1.0; +https://reflection.ai/bot)",
];
const MUST_PASS = [
  "Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.5 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)",
  // Link previews of our Facebook posts, and a person asking Meta AI about a link: not the AI crawler.
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  "meta-externalfetcher/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
  "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)",
  "WhatsApp/2.23.20.0",
];

describe("isBlockedCrawler", () => {
  it("refuses the crawlers that were draining the bill", () => {
    for (const ua of SEEN_AND_BLOCKED) expect(isBlockedCrawler(ua), ua).toBe(true);
  });

  it("lets through people, search engines, link previews and the answer engines that send visitors", () => {
    for (const ua of MUST_PASS) expect(isBlockedCrawler(ua), ua).toBe(false);
  });

  it("ignores case, and a missing User-Agent is a visitor, not a crawler", () => {
    expect(isBlockedCrawler("gptbot/1.0")).toBe(true);
    expect(isBlockedCrawler("SEMRUSHBOT")).toBe(true);
    expect(isBlockedCrawler(null)).toBe(false);
    expect(isBlockedCrawler(undefined)).toBe(false);
    expect(isBlockedCrawler("")).toBe(false);
  });
});

describe("/robots.txt", () => {
  const rules = (Array.isArray(robots().rules) ? robots().rules : [robots().rules]) as { userAgent?: string | string[]; disallow?: string | string[] }[];

  it("asks every blocked crawler to stay out of the whole site", () => {
    const blocked = rules.find((r) => Array.isArray(r.userAgent) && r.userAgent.includes("GPTBot"));
    expect(blocked?.disallow).toBe("/");
    expect([...(blocked?.userAgent as string[])].sort()).toEqual([...BLOCKED_CRAWLERS].sort());
  });

  it("keeps the search engines out of the catalogue's free-text searches and the request form, nothing more of the catalogue", () => {
    const everyone = rules.find((r) => r.userAgent === "*");
    const dis = everyone?.disallow as string[];
    expect(dis).toContain("/*?q=");
    expect(dis).toContain("/*&q=");
    expect(dis).toContain("/fr/demandes/nouvelle");
    expect(dis).not.toContain("/fr/annonces");
    expect(dis).not.toContain("/");
  });
});

describe("the proxy", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src", "proxy.ts"), "utf8");

  it("refuses a blocked crawler before routing, sessions or logging", () => {
    const refuse = src.indexOf("isBlockedCrawler(");
    expect(refuse).toBeGreaterThan(0);
    for (const later of ["publicPathOfTwin(", "intlMiddleware(req)", "createServerClient(", "logActivity({"]) {
      expect(src.indexOf(later, refuse), later).toBeGreaterThan(refuse);
    }
  });

  it("leaves /robots.txt and the sitemap outside its matcher, so a crawler can still read them", () => {
    const literal = /matcher:\s*\["((?:[^"\\]|\\.)*)"\]/.exec(src)?.[1] ?? "";
    expect(literal).toContain("txt");
    expect(literal).toContain("xml");
  });
});

describe("the small door (Meta's AI crawler, 2026-11-25)", () => {
  const META = "meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)";

  it("knows Meta's AI crawler as limited, not blocked, and nothing else as limited", () => {
    expect(isBlockedCrawler(META)).toBe(false);
    expect(limitedCrawler(META)?.name).toBe("meta-externalagent");
    for (const ua of ["facebookexternalhit/1.1", "meta-externalfetcher/1.1", "Mozilla/5.0 (compatible; Googlebot/2.1)", null, ""]) expect(limitedCrawler(ua), String(ua)).toBeNull();
  });

  it("answers by budget, then by the address, then by the day's count", () => {
    expect(doorVerdict({ hasQuery: false, budget: 0, over: null })).toBe("closed");
    expect(doorVerdict({ hasQuery: true, budget: 3000, over: null })).toBe("query");
    expect(doorVerdict({ hasQuery: false, budget: 3000, over: true })).toBe("over");
    expect(doorVerdict({ hasQuery: false, budget: 3000, over: false })).toBe("allow");
    // The counter could not be asked: let it through (a brake, not a lock).
    expect(doorVerdict({ hasQuery: false, budget: 3000, over: null })).toBe("allow");
  });

  it("gives it its own robots group: every private path, plus any query string", () => {
    const rules = (Array.isArray(robots().rules) ? robots().rules : [robots().rules]) as { userAgent?: string | string[]; disallow?: string | string[] }[];
    const door = rules.find((r) => Array.isArray(r.userAgent) && r.userAgent.includes("meta-externalagent"));
    const dis = door?.disallow as string[];
    expect(dis).toContain("/*?");
    expect(dis).toContain("/fr/admin");
    expect(dis).toContain("/api/");
    expect(dis).not.toContain("/");
    expect(LIMITED_CRAWLERS.every((c) => !(BLOCKED_CRAWLERS as readonly string[]).includes(c.name))).toBe(true);
  });
});

describe("a missing annonce for the search engines (2026-11-25)", () => {
  it("knows the crawlers of search and answer engines, not people or link previews", async () => {
    const { isSearchCrawler } = await import("./crawlers");
    for (const ua of ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "Mozilla/5.0 (compatible; bingbot/2.0)", "Mozilla/5.0 (compatible; OAI-SearchBot/1.0)", "meta-externalagent/1.1"]) expect(isSearchCrawler(ua), ua).toBe(true);
    for (const ua of ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) Safari/604.1", "facebookexternalhit/1.1", "WhatsApp/2.23", null]) expect(isSearchCrawler(ua), String(ua)).toBe(false);
  });

  it("reads an annonce's address, and whether its id can be one", async () => {
    const { annoncePath } = await import("./crawlers");
    expect(annoncePath("/fr/annonces/0470203d-6473-4059-9c98-7f9778f98cdc")).toEqual({ locale: "fr", id: "0470203d-6473-4059-9c98-7f9778f98cdc", wellFormed: true });
    expect(annoncePath("/ar/annonces/abc/")).toEqual({ locale: "ar", id: "abc", wellFormed: false });
    expect(annoncePath("/fr/annonces/nouvelle")).toBeNull();
    expect(annoncePath("/fr/annonces")).toBeNull();
    expect(annoncePath("/fr/annonces/0470203d-6473-4059-9c98-7f9778f98cdc/mise-en-avant")).toBeNull();
  });
});
