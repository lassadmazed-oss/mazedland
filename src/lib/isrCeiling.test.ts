import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Next keeps the LOWEST `revalidate` of a route's layouts and page. The locale
 * layout's number is therefore a ceiling: a page may ask for a slower rebuild
 * than the layout's and silently not get it (the market figures, the Pro page
 * and the directory were rebuilt, and stored, every minute because of it).
 */
const app = path.join(process.cwd(), "src", "app");
const localeDir = path.join(app, "[locale]");

function pagesUnder(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) pagesUnder(p, out);
    else if (e.name === "page.tsx") out.push(p);
  }
  return out;
}

const REVALIDATE = /^export const revalidate = (\d+);/m;
const read = (p: string) => fs.readFileSync(p, "utf8");
const valueOf = (p: string): number | null => {
  const m = REVALIDATE.exec(read(p));
  return m ? Number(m[1]) : null;
};

describe("the layout's revalidate is a ceiling", () => {
  const ceiling = valueOf(path.join(localeDir, "layout.tsx"));

  it("is a number the layout sets", () => {
    expect(ceiling).not.toBeNull();
  });

  it("is not lower than the rebuild any page asks for", () => {
    const asked = pagesUnder(localeDir)
      .map((p) => ({ p: path.relative(process.cwd(), p), v: valueOf(p) }))
      .filter((x): x is { p: string; v: number } => x.v !== null && x.v > 0);
    expect(asked.length).toBeGreaterThan(5);
    for (const { p, v } of asked) expect(ceiling, `${p} asks for ${v}s`).toBeGreaterThanOrEqual(v);
  });

  it("leaves no static page to ride on it unnamed: they say their own number", () => {
    for (const rel of ["terms", "privacy", "contact"]) {
      expect(valueOf(path.join(localeDir, rel, "page.tsx")), rel).toBe(60);
    }
  });
});

describe("a slow page is rebuilt at once by the change that matters to it", () => {
  const api = (rel: string) => read(path.join(app, "api", "admin", rel, "route.ts"));

  it("settings: the whole site", () => {
    expect(api("settings")).toMatch(/revalidateSite\(\)/);
  });

  it("agences: the directory and the Pro page's places left", () => {
    const src = read(path.join(app, "api", "admin", "boutiques", "[id]", "route.ts"));
    expect(src).toMatch(/revalidatePublic\("\/agences", "\/pro"\)/);
  });

  it("plans: the Pro page", () => {
    const src = api("products");
    expect(src.match(/revalidatePublic\("\/pro"\)/g)?.length).toBe(3);
  });
});
