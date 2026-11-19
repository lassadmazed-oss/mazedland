/**
 * The licence of an agency (0230).
 *
 * An agency in Tunisia needs the Ministry of Commerce's agrément. The agency
 * types its number; the public page says « Agence agréée » only once an admin
 * has checked that number against the licence shown — never for a number nobody
 * has looked at, and not after the number changed.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { licenceNumber, parseShopInput } from "./shops";

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const base = { name: "Agence Test", governorate: "Sfax" };

describe("licenceNumber", () => {
  it("keeps what is written on a licence: letters, digits and the signs between them", () => {
    expect(licenceNumber("  AG/2021 - 0457 ")).toBe("AG/2021 - 0457");
    expect(licenceNumber("12345")).toBe("12345");
    expect(licenceNumber("رخصة 45/2020")).toBe("رخصة 45/2020");
    expect(licenceNumber("agr.2019_33")).toBe("agr.2019_33");
  });

  it("refuses what is not a number: empty, signs only, markup", () => {
    expect(licenceNumber("")).toBeNull();
    expect(licenceNumber("   ")).toBeNull();
    expect(licenceNumber("---")).toBeNull();
    expect(licenceNumber("<script>1</script>")).toBeNull();
    expect(licenceNumber(undefined)).toBeNull();
    expect(licenceNumber(12345)).toBeNull();
  });

  it("is cut at 40 characters", () => {
    expect((licenceNumber("A".repeat(80)) ?? "").length).toBe(40);
  });
});

describe("the shop input", () => {
  it("keeps an agency's licence number", () => {
    const r = parseShopInput({ ...base, kind: "agency", licence_number: "AG/2021-0457" }, "u1");
    expect(r.ok && r.value.licence_number).toBe("AG/2021-0457");
  });

  it("leaves it null for a promoter or a land developer: the ministry licenses agencies", () => {
    for (const kind of ["promoter", "land_developer", "property_manager"]) {
      const r = parseShopInput({ ...base, kind, licence_number: "AG/2021-0457" }, "u1");
      expect(r.ok && r.value.licence_number, kind).toBeNull();
    }
  });

  it("an agency may leave it out (Réglages decides whether that is allowed)", () => {
    const r = parseShopInput({ ...base, kind: "agency" }, "u1");
    expect(r.ok && r.value.licence_number).toBeNull();
  });
});

describe("who says « agréée »", () => {
  it("the owner's save takes the check off when the number changes (or goes)", () => {
    const src = read("src/app/api/pro/shops/[id]/route.ts");
    expect(src).toMatch(/stored\?\.licence_checked_at && \(stored\.licence_number \?\? null\) !== \(parsed\.value\.licence_number \?\? null\)/);
    expect(src).toMatch(/update\.licence_checked_at = null/);
  });

  it("the console checks only an agency, and only a number that was given", () => {
    const src = read("src/app/api/admin/boutiques/[id]/route.ts");
    const block = src.slice(src.indexOf('case "licence_verify"'), src.indexOf('case "licence_unverify"'));
    expect(block).toMatch(/shop\.kind !== "agency"/);
    expect(block).toMatch(/!shop\.licence_number/);
    expect(block).toMatch(/licence_checked_at: now, licence_checked_by: by/);
  });

  it("the table refuses a check without a number", () => {
    expect(read("supabase/migrations/0230_agency_licence.sql")).toMatch(/check \(licence_checked_at is null or licence_number is not null\)/);
  });

  it("the public page shows the badge only for a checked number", () => {
    const src = read("src/app/[locale]/agences/[slug]/ShopView.tsx");
    expect(src).toMatch(/shop\.licence_checked_at && shop\.licence_number/);
    // The number alone, unchecked, is never printed on the page.
    expect(src.match(/shop\.licence_number/g)?.length).toBeGreaterThanOrEqual(2);
    expect(src).not.toMatch(/\{shop\.licence_number\}/);
  });

  it("Réglages can make the number required, and the creation route reads it", () => {
    expect(read("src/app/api/pro/shops/route.ts")).toMatch(/settings\.shop_licence_required && parsed\.value\.kind === "agency" && !parsed\.value\.licence_number/);
  });

  it("the licence can be sent with the other papers", () => {
    expect(read("src/app/api/pro/shops/[id]/documents/route.ts")).toMatch(/"licence"/);
    expect(read("src/app/[locale]/pro/dashboard/ProActions.tsx")).toMatch(/"licence"/);
    expect(read("supabase/migrations/0230_agency_licence.sql")).toMatch(/'licence'/);
  });
});
