import { describe, it, expect } from "vitest";
import {
  SEARCH_SOURCES, SOURCE_SECTION, cleanTerm, fold, labelScore, listingRefFor, phoneDigits, searchHref, socialRefFor,
} from "./search";
import { canOpen } from "./sections";

describe("cleanTerm", () => {
  it("takes out what would change a PostgREST or() filter", () => {
    expect(cleanTerm('  villa, (sfax)* 50% "x" \\ ')).toBe("villa sfax 50 x");
  });
  it("keeps 60 characters at most", () => {
    expect(cleanTerm("a".repeat(80))).toHaveLength(60);
  });
});

describe("listingRefFor", () => {
  it("reads a reference however it is typed", () => {
    expect(listingRefFor("1643")).toBe("MZ-01643");
    expect(listingRefFor("mz-1643")).toBe("MZ-01643");
    expect(listingRefFor("MZ 01643")).toBe("MZ-01643");
  });
  it("is not a phone number or a word", () => {
    expect(listingRefFor("98124111")).toBeNull();
    expect(listingRefFor("villa 3")).toBeNull();
  });
});

describe("phoneDigits", () => {
  it("reads a number however it is typed, and nothing else as one", () => {
    expect(phoneDigits("98 124 111")).toBe("98124111");
    expect(phoneDigits("+216 98-124-111")).toBe("21698124111");
    expect(phoneDigits("MZ-01643")).toBeNull();
    expect(phoneDigits("فيلا 3")).toBeNull();
    expect(phoneDigits("12")).toBeNull();
  });
});

describe("socialRefFor", () => {
  it("reads « MZ-91A470 » and « 91a470 »", () => {
    expect(socialRefFor("MZ-91A470")).toBe("91A470");
    expect(socialRefFor("91a470")).toBe("91A470");
    expect(socialRefFor("villa")).toBeNull();
  });
});

describe("searchHref", () => {
  it("opens each row where it is changed", () => {
    expect(searchHref.listing("id-1", "MZ-01643")).toBe("/admin/annonces?status=all&q=MZ-01643&a=id-1");
    expect(searchHref.listing("id-1", null)).toBe("/admin/annonces?status=all&a=id-1");
    expect(searchHref.shop("s1")).toBe("/admin/agences?status=all&id=s1");
    expect(searchHref.payment("c243037d-1111-2222-3333-444455556666")).toBe(
      "/admin/paiements?status=all&q=c243037d&a=c243037d-1111-2222-3333-444455556666",
    );
    expect(searchHref.setting("features", "feature_visits")).toBe("/admin/settings?g=features&k=feature_visits");
    expect(searchHref.social("pending_approval")).toBe("/admin/social");
    expect(searchHref.social("published")).toBe("/admin/social?tab=publies");
  });
});

describe("fold and labelScore", () => {
  it("ignores case, accents and the Arabic letters written either way", () => {
    expect(fold("Réglages")).toBe("reglages");
    expect(fold("إعلانات")).toBe(fold("اعلانات"));
    expect(fold("صفحة")).toBe(fold("صفحه"));
  });
  it("needs every word, and ranks the label above its hint", () => {
    expect(labelScore("paiement recu", "Paiements", "Reçus à valider")).toBeGreaterThan(0);
    expect(labelScore("paiement banque", "Paiements", "Reçus à valider")).toBe(0);
    expect(labelScore("pai", "Paiements")).toBeGreaterThan(labelScore("pai", "Offres", "Paiement des packs"));
  });
});

describe("SOURCE_SECTION", () => {
  it("names a section for every source, so a member sees only theirs", () => {
    for (const s of SEARCH_SOURCES) expect(SOURCE_SECTION[s]).toBeTruthy();
    const moderator = ["annonces", "vendeurs"] as const;
    const visible = SEARCH_SOURCES.filter((s) => canOpen(moderator, SOURCE_SECTION[s]));
    expect(visible).toEqual(["listings", "sellers"]);
  });
});
