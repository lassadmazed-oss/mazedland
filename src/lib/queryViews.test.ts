/**
 * Which addresses the proxy sends to a page's dynamic twin (src/lib/queryViews.ts):
 * the query keys that change what the page shows, and nothing else — a link
 * shared with ?fbclid= must stay on the CDN.
 */
import { describe, expect, it } from "vitest";
import { publicPathOfTwin, queryViewPath } from "./queryViews";

const twin = (path: string, query = "") => queryViewPath(path, new URLSearchParams(query));

describe("queryViewPath", () => {
  it("leaves the bare pages to the CDN", () => {
    for (const p of ["/fr/guides", "/ar/guides/acheter-un-bien", "/fr/agences/abir-immo", "/fr/agences/x/projets/residence-a"]) {
      expect(twin(p), p).toBeNull();
    }
  });

  it("leaves to the CDN a query that changes nothing on the page", () => {
    expect(twin("/fr/agences/abir-immo", "fbclid=abc&utm_source=facebook")).toBeNull();
    expect(twin("/fr/guides", "utm_campaign=x")).toBeNull();
    // A key of another page.
    expect(twin("/fr/guides", "deal=sale")).toBeNull();
    expect(twin("/fr/agences/abir-immo", "tag=achat")).toBeNull();
  });

  it("sends the views a query picks to the twin, under the same locale", () => {
    expect(twin("/fr/guides", "tag=achat")).toBe("/fr/_query/guides");
    expect(twin("/ar/guides", "page=2")).toBe("/ar/_query/guides");
    expect(twin("/fr/guides/mon-guide", "apercu=1")).toBe("/fr/_query/guides/mon-guide");
    expect(twin("/fr/agences/abir-immo", "deal=sale")).toBe("/fr/_query/agences/abir-immo");
    expect(twin("/ar/agences/abir-immo", "page=3&utm_source=x")).toBe("/ar/_query/agences/abir-immo");
    expect(twin("/fr/agences/x/projets/residence-a", "f=available")).toBe("/fr/_query/agences/x/projets/residence-a");
  });

  it("an empty value still picks the twin, which reads it as the page did", () => {
    expect(twin("/fr/agences/abir-immo", "page=")).toBe("/fr/_query/agences/abir-immo");
  });

  it("knows no other page", () => {
    expect(twin("/fr/annonces", "page=2")).toBeNull();
    expect(twin("/fr", "page=2")).toBeNull();
    expect(twin("/fr/agences", "page=2")).toBeNull();
    expect(twin("/fr/agences/x/projets", "f=available")).toBeNull();
  });
});

describe("publicPathOfTwin", () => {
  it("finds the public address of a twin", () => {
    expect(publicPathOfTwin("/fr/_query/guides")).toBe("/fr/guides");
    expect(publicPathOfTwin("/ar/_query/agences/x/projets/y")).toBe("/ar/agences/x/projets/y");
    expect(publicPathOfTwin("/fr/_query")).toBe("/fr");
  });

  it("leaves every other address alone", () => {
    expect(publicPathOfTwin("/fr/guides")).toBeNull();
    expect(publicPathOfTwin("/fr/_queryx/guides")).toBeNull();
    expect(publicPathOfTwin("/fr/agences/_query")).toBeNull();
  });
});
