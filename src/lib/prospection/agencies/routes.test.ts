/**
 * Who may do what with the agencies list (0229).
 *
 * The list is worked by a team. The whole console (the owner) sees all of it,
 * imports and shares it out; a member sees and works only the agencies in their
 * charge. The rule is `mayWorkAgency`; what keeps it true is that every route
 * and screen of ONE agency opens it through `loadOwnAgency`, never `loadAgency`,
 * and that the list screens narrow a member to their own.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

const ONE_AGENCY = [
  "src/app/api/admin/prospection/agences/[id]/route.ts",
  "src/app/[locale]/admin/prospection/agences/[id]/page.tsx",
];

describe("every route and screen of one agency", () => {
  it.each(ONE_AGENCY)("%s opens it through loadOwnAgency", (file) => {
    const src = read(file);
    expect(src).toMatch(/loadOwnAgency\(/);
    expect(src).not.toMatch(/\bloadAgency\(/);
  });
});

describe("the owner's routes", () => {
  it.each([
    "src/app/api/admin/prospection/agences/import/route.ts",
    "src/app/api/admin/prospection/agences/share/route.ts",
  ])("%s refuse a member", (file) => {
    expect(read(file)).toMatch(/gate\.scopes !== null\) return NextResponse\.json\(\{ error: "forbidden" \}, \{ status: 403 \}\)/);
  });

  it("assigning an agency is the owner's too", () => {
    const src = read("src/app/api/admin/prospection/agences/[id]/route.ts");
    const block = src.slice(src.indexOf('action === "assign"'));
    expect(block).toMatch(/gate\.scopes !== null\) return NextResponse\.json\(\{ error: "forbidden" \}/);
  });

  it("the import and the sharing page are not found for a member", () => {
    expect(read("src/app/[locale]/admin/prospection/agences/import/page.tsx")).toMatch(/scopes !== null\) notFound\(\)/);
  });
});

describe("the list", () => {
  it("narrows a member to the agencies in their charge, whatever the address says", () => {
    const src = read("src/app/[locale]/admin/prospection/agences/page.tsx");
    // `who` is the owner's choice only; a member is always themselves.
    expect(src).toMatch(/const who = everyone \? .* : user\.id;/);
    expect(src).toMatch(/agencyFunnel\(admin, everyone \? undefined : user\.id\)/);
  });

  it("gives a member no team table and no sharing form", () => {
    const src = read("src/app/[locale]/admin/prospection/agences/page.tsx");
    expect(src).toMatch(/everyone \? agencyStockByMember\(admin\) : Promise\.resolve\(\[\]\)/);
    expect(src).toMatch(/\{everyone \? \(\s*<section className="mt-6">/);
  });

  it("a number refused by « ne pas contacter » never gets onto it (import and by hand)", () => {
    expect(read("src/lib/prospection/agencies/server.ts")).toMatch(/prospect_dnc/);
    expect(read("src/app/api/admin/prospection/agences/route.ts")).toMatch(/error: "do_not_contact"/);
  });
});

describe("the report", () => {
  it("is the owner's page: a member is not shown the team's day", () => {
    expect(read("src/app/[locale]/admin/prospection/rapport/page.tsx")).toMatch(/if \(scopes !== null\) notFound\(\)/);
  });
});
