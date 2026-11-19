import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { decodeImport } from "./importLink";
// A plain script (no module syntax) so Chrome can inject it: loaded here the way Node loads CommonJS.
import { buildZip, readFolder } from "../../../scripts/lib/zip.mjs";

const require = createRequire(import.meta.url);
const { extractPost, encodePayload, tidyUrl } = require("../../../extension/prospection/extract.js") as {
  extractPost: (doc: unknown, win: unknown, loc: unknown) => { text: string; url: string; name: string; source: string };
  encodePayload: (p: { text: string; url: string; name: string }) => string;
  tidyUrl: (href: string, base: string) => string;
};

const ROOT = process.cwd();
const EXT = path.join(ROOT, "extension", "prospection");

// ── a pocket-sized stand-in for the bits of the DOM the extractor touches ──
type Fake = Record<string, unknown>;
function el(o: { text?: string; top?: number; bottom?: number; nested?: boolean; q?: Record<string, Fake | null>; qa?: Record<string, Fake[]>; closestArticle?: () => Fake | null }): Fake {
  const self: Fake = {
    nodeType: 1,
    innerText: o.text ?? "",
    textContent: o.text ?? "",
    parentElement: { closest: () => (o.nested ? {} : null) },
    getBoundingClientRect: () => ({ top: o.top ?? 0, bottom: o.bottom ?? 100 }),
    querySelector: (sel: string) => {
      const hit = Object.entries(o.q ?? {}).find(([k]) => sel.includes(k));
      return hit ? hit[1] : null;
    },
    querySelectorAll: (sel: string) => {
      const hit = Object.entries(o.qa ?? {}).find(([k]) => sel.includes(k));
      return hit ? hit[1] : [];
    },
    closest: () => (o.closestArticle ? o.closestArticle() : null),
    getAttribute: (n: string) => (n === "href" ? o.text ?? "" : null),
  };
  return self;
}
const win = (height: number, selected = "", anchor: Fake | null = null) => ({
  innerHeight: height,
  getSelection: () => ({ toString: () => selected, anchorNode: anchor }),
});
const loc = (href: string) => ({ href });
const doc = (articles: Fake[]) => ({ querySelectorAll: (sel: string) => (sel.includes("article") ? articles : []) });

const POST = "دار للبيع في صفاقس طريق قرمدة 180 متر مربع السوم 350 مليون للاتصال 20 000 001";

describe("extractPost", () => {
  it("takes the text the member selected, and finds the poster and the link in the post around it", () => {
    const link = el({ text: "https://www.facebook.com/groups/12/posts/99/?__cft__[0]=abc&__tn__=%2CO" });
    const article: Fake = el({ q: { "h2 a": el({ text: "سامي بن علي" }), "/posts/": link } });
    const anchorEl = el({ closestArticle: () => article });
    const out = extractPost(doc([article]), win(800, POST, { nodeType: 3, parentElement: anchorEl }), loc("https://www.facebook.com/groups/12/"));
    expect(out.source).toBe("selection");
    expect(out.text).toBe(POST);
    expect(out.name).toBe("سامي بن علي");
    expect(out.url).toBe("https://www.facebook.com/groups/12/posts/99/");
  });

  it("without a selection, reads the post that holds the middle of the window, not a comment nor another post", () => {
    const message = el({ text: POST });
    const comment = el({ text: "تعليق", nested: true, top: 300, bottom: 400 });
    const above = el({ top: -900, bottom: -100, q: { "data-ad-preview": el({ text: "بوست آخر فوق" }) } });
    const mine = el({ top: 100, bottom: 700, q: { "data-ad-preview": message, "h2 a": el({ text: "Sami" }) } });
    const out = extractPost(doc([above, mine, comment]), win(800), loc("https://www.facebook.com/groups/12/permalink/55/"));
    expect(out.source).toBe("article");
    expect(out.text).toBe(POST);
    expect(out.name).toBe("Sami");
    expect(out.url).toBe("https://www.facebook.com/groups/12/permalink/55/");
  });

  it("falls back to the text blocks of the post, each once, leaves only", () => {
    const article: Fake = el({ top: 0, bottom: 800 });
    const inside = (text: string) => el({ text, closestArticle: () => article });
    (article.querySelectorAll as unknown) = () => [inside(`${POST}\nسطر ثاني في البوست`), inside(POST), inside(POST), inside("قصير")];
    const out = extractPost(doc([article]), win(800), loc("https://www.facebook.com/groups/12/"));
    expect(out.source).toBe("article");
    expect(out.text).toBe(POST);
  });

  it("says so when there is nothing to read", () => {
    const out = extractPost(doc([]), win(800), loc("https://www.facebook.com/"));
    expect(out).toMatchObject({ text: "", name: "", source: "none" });
  });

  it("never returns more than the form takes", () => {
    const out = extractPost(doc([]), win(800, "x".repeat(20_000)), loc("https://www.facebook.com/"));
    expect(out.text.length).toBe(8_000);
  });
});

describe("tidyUrl", () => {
  it("keeps the path and the few parameters that name a post, drops the tracking", () => {
    expect(tidyUrl("https://www.facebook.com/permalink.php?story_fbid=1&id=2&__cft__[0]=z&fbclid=q", "https://www.facebook.com/"))
      .toBe("https://www.facebook.com/permalink.php?story_fbid=1&id=2");
  });

  it("resolves a relative link, and refuses another site", () => {
    expect(tidyUrl("/groups/1/posts/2/?x=1", "https://m.facebook.com/")).toBe("https://m.facebook.com/groups/1/posts/2/");
    expect(tidyUrl("https://evil.example/groups/1/posts/2", "https://www.facebook.com/")).toBe("");
    expect(tidyUrl("javascript:alert(1)", "https://www.facebook.com/")).toBe("");
  });
});

describe("what the extension hands to the site", () => {
  it("round-trips an Arabic post through the fragment", () => {
    const hash = `#import=${encodePayload({ text: POST, url: "https://www.facebook.com/groups/1/posts/2/", name: "سامي" })}`;
    expect(decodeImport(hash)).toEqual({ text: POST, url: "https://www.facebook.com/groups/1/posts/2/", name: "سامي" });
  });

  it("is only ever a fragment value of url-safe characters", () => {
    expect(encodePayload({ text: POST.repeat(40), url: "", name: "" })).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("refuses a link that is not ours, is empty, is too big, or carries a link that is not http", () => {
    expect(decodeImport("")).toBeNull();
    expect(decodeImport("#import=%%%")).toBeNull();
    expect(decodeImport("#other=abc")).toBeNull();
    expect(decodeImport(`#import=${"A".repeat(30_000)}`)).toBeNull();
    const noText = `#import=${encodePayload({ text: "", url: "", name: "x" })}`;
    expect(decodeImport(noText)).toBeNull();
    const odd = decodeImport(`#import=${encodePayload({ text: POST, url: "javascript:alert(1)", name: "" })}`);
    expect(odd?.url).toBe("");
  });
});

describe("the extension itself", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8")) as Record<string, unknown>;

  it("reads a page only when the member clicks: no host permission, no script running by itself", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(["activeTab", "scripting", "storage"]);
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.content_scripts).toBeUndefined();
    expect(manifest.background).toBeUndefined();
    expect(manifest.optional_host_permissions).toBeUndefined();
  });

  it("ships every file its manifest and popup name", () => {
    const html = fs.readFileSync(path.join(EXT, "popup.html"), "utf8");
    const named = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
    for (const f of [...named, "popup.html", ...Object.values(manifest.icons as Record<string, string>)]) {
      expect(fs.existsSync(path.join(EXT, f)), f).toBe(true);
    }
    expect(fs.existsSync(path.join(EXT, "extract.js"))).toBe(true);
  });

  it("opens the site's own page and sends nothing from the browser", () => {
    const popup = fs.readFileSync(path.join(EXT, "popup.js"), "utf8");
    expect(popup).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon/);
    expect(popup).toContain("/admin/prospection/nouveau#import=");
  });

  it("is offered as the zip the folder builds today (node scripts/build-extension.mjs)", () => {
    const built = buildZip(readFolder(EXT), "mazed-prospection");
    const committed = fs.readFileSync(path.join(ROOT, "public", "downloads", "mazed-prospection-extension.zip"));
    expect(Buffer.compare(built, committed)).toBe(0);
  });
});
