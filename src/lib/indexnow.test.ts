import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { annonceUrls, indexNowBody, INDEXNOW_MAX_URLS, INDEXNOW_STATUSES } from "./indexnow";

describe("IndexNow", () => {
  it("names the host, the key and where the key file is", () => {
    expect(indexNowBody("https://www.mazed.immo/", "k123", ["https://www.mazed.immo/fr"])).toEqual({
      host: "www.mazed.immo",
      key: "k123",
      keyLocation: "https://www.mazed.immo/indexnow.txt",
      urlList: ["https://www.mazed.immo/fr"],
    });
  });

  it("sends each address once, and no more than the protocol takes", () => {
    expect(indexNowBody("https://www.mazed.immo", "k", ["a", "a", "b"]).urlList).toEqual(["a", "b"]);
    const many = Array.from({ length: INDEXNOW_MAX_URLS + 5 }, (_, i) => `u${i}`);
    expect(indexNowBody("https://www.mazed.immo", "k", many).urlList).toHaveLength(INDEXNOW_MAX_URLS);
  });

  it("gives an annonce's address in every language", () => {
    expect(annonceUrls("https://www.mazed.immo", ["id1", "id2"], ["fr", "ar"])).toEqual([
      "https://www.mazed.immo/fr/annonces/id1",
      "https://www.mazed.immo/ar/annonces/id1",
      "https://www.mazed.immo/fr/annonces/id2",
      "https://www.mazed.immo/ar/annonces/id2",
    ]);
  });
});

describe("IndexNow's statuses (2026-11-25)", () => {
  it("are all values of listing_status, as the migrations define it", () => {
    // The enum: created in one migration, values added in later ones.
    const dir = path.resolve(__dirname, "../../supabase/migrations");
    const values = new Set<string>();
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".sql"))) {
      const sql = fs.readFileSync(path.join(dir, f), "utf8");
      const created = /create type public\.listing_status as enum \(([^)]*)\)/i.exec(sql);
      if (created) for (const m of created[1].matchAll(/'([a-z_]+)'/g)) values.add(m[1]);
      for (const m of sql.matchAll(/alter type public\.listing_status add value if not exists '([a-z_]+)'/gi)) values.add(m[1]);
    }
    expect(values.has("published")).toBe(true);
    for (const s of INDEXNOW_STATUSES) expect([...values], s).toContain(s);
  });
});
