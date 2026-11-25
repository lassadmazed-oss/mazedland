import { describe, it, expect } from "vitest";
import { annonceUrls, indexNowBody, INDEXNOW_MAX_URLS } from "./indexnow";

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
