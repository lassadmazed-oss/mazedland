import { describe, expect, it } from "vitest";
import {
  canRecord, countAgencyFigures, declineNote, fold, governorateFrom, governorateIn, matchAgencyShops, mayWorkAgency, parseCsv, patchForResult,
  planImport, readAgencyCsv, resultBlockers, shareOut, splitDeclineNote, stageOf, agencyLine,
} from "./model";

describe("parseCsv", () => {
  it("reads commas, semicolons and tabs, whichever the first line uses", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
    expect(parseCsv("a;b;c\n1;2;3")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
    expect(parseCsv("a\tb\tc\n1\t2\t3")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });

  it("keeps a separator, a newline and a doubled quote inside quotes", () => {
    expect(parseCsv('nom,adresse\n"Agence, Sfax","Rue ""A""\n2e étage"')).toEqual([
      ["nom", "adresse"],
      ["Agence, Sfax", 'Rue "A"\n2e étage'],
    ]);
  });

  it("drops the BOM Excel writes, CRLF line ends and empty lines", () => {
    expect(parseCsv("﻿a,b\r\n1,2\r\n\r\n3,4\r\n")).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
  });
});

describe("governorates in a CSV", () => {
  it("reads French and Arabic names, with or without accents", () => {
    expect(governorateFrom("Sfax")).toBe("Sfax");
    expect(governorateFrom("sfax")).toBe("Sfax");
    expect(governorateFrom("Gabes")).toBe("Gabès");
    expect(governorateFrom("Médenine")).toBe("Médenine");
    expect(governorateFrom("Le Kef")).toBe("Kef");
    expect(governorateFrom("صفاقس")).toBe("Sfax");
    expect(governorateFrom("نابل")).toBe("Nabeul");
    expect(governorateFrom("Paris")).toBeNull();
    expect(governorateFrom("")).toBeNull();
  });

  it("finds one named in an address, as a whole word", () => {
    expect(governorateIn("Rue de Marseille, 3000 Sfax")).toBe("Sfax");
    expect(governorateIn("Avenue Habib Bourguiba, Sidi Bouzid")).toBe("Sidi Bouzid");
    expect(governorateIn("Cité Ben Arous 2")).toBe("Ben Arous");
    // « Tunisie » is not « Tunis ».
    expect(governorateIn("Tunisie")).toBeNull();
    expect(governorateIn(null)).toBeNull();
  });

  it("folds names the same way for names and headers", () => {
    expect(fold("Raison sociale")).toBe("raisonsociale");
    expect(fold("Téléphone")).toBe("telephone");
    expect(fold("الوكالة")).toBe("الوكالة");
  });
});

describe("readAgencyCsv", () => {
  it("reads the columns by their French, English or Arabic names", () => {
    const r = readAgencyCsv("Nom;Téléphone;Gouvernorat;Adresse;Site web;Agréée\nAgence Bahri;74 123 456;Sfax;Rue 1;www.bahri.tn;oui");
    expect(r.problems).toEqual([]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ line: 2, name: "Agence Bahri", phone: "+21674123456", governorate: "Sfax", address: "Rue 1", website: "https://www.bahri.tn", licensed: true });

    const ar = readAgencyCsv("الاسم,الهاتف,الولاية\nوكالة النجاح,98 765 432,صفاقس");
    expect(ar.rows[0]).toMatchObject({ name: "وكالة النجاح", phone: "+21698765432", governorate: "Sfax" });
  });

  it("takes two numbers from one cell, in order", () => {
    const r = readAgencyCsv("name,phone\nA,71 123 456 / 98 765 432");
    expect(r.rows[0]).toMatchObject({ phone: "+21671123456", phone2: "+21698765432" });
  });

  it("finds the governorate in the address when its column is empty or missing", () => {
    expect(readAgencyCsv("name,phone,address\nA,98765432,Rue 5 Sousse").rows[0].governorate).toBe("Sousse");
    expect(readAgencyCsv("name,phone,governorate,address\nA,98765432,,Rue 5 Sousse").rows[0].governorate).toBe("Sousse");
  });

  it("leaves out a row with no name, an unreadable number, or nothing to reach it by — and says so", () => {
    const r = readAgencyCsv("name,phone,website\n,98765432,\nB,12,\nC,,\nD,,https://d.tn");
    expect(r.problems).toEqual([
      { line: 2, why: "no_name" },
      { line: 3, why: "bad_phone" },
      { line: 4, why: "nothing_to_reach" },
    ]);
    // D has only a site: it is kept, to be found by hand.
    expect(r.rows.map((x) => x.name)).toEqual(["D"]);
  });

  it("puts a Facebook address typed in the website column where it belongs", () => {
    const r = readAgencyCsv("name,website\nE,https://www.facebook.com/agence.e");
    expect(r.rows[0]).toMatchObject({ website: null, facebook_url: "https://www.facebook.com/agence.e" });
  });

  it("returns nothing for an empty file", () => {
    expect(readAgencyCsv("")).toEqual({ rows: [], problems: [], columns: [] });
  });
});

describe("planImport", () => {
  const row = (line: number, name: string, phone: string | null, governorate: "Sfax" | "Tunis" | null = "Sfax") =>
    ({ line, name, phone, phone2: null, governorate, city: null, address: null, website: null, facebook_url: null, email: null, legal_id: null, licensed: null, note: null }) as const;
  const none = { phones: new Set<string>(), nameKeys: new Set<string>(), dnc: new Set<string>() };

  it("adds new numbers and counts those without one", () => {
    const p = planImport([row(2, "A", "+21671000001"), row(3, "B", null)], none);
    expect(p.insert.map((r) => r.name)).toEqual(["A", "B"]);
    expect(p.withoutNumber).toBe(1);
  });

  it("refuses a number already on the list, or twice in the file", () => {
    const p = planImport(
      [row(2, "A", "+21671000001"), row(3, "A bis", "+21671000001"), row(4, "C", "+21671000002")],
      { ...none, phones: new Set(["+21671000002"]) },
    );
    expect(p.insert.map((r) => r.name)).toEqual(["A"]);
    expect(p.duplicates).toEqual([
      { line: 3, name: "A bis", phone: "+21671000001", where: "file" },
      { line: 4, name: "C", phone: "+21671000002", where: "list" },
    ]);
  });

  it("matches an agency with no number by its name and governorate", () => {
    const p = planImport([row(2, "Agence Sud", null), row(3, "AGENCE  sud", null), row(4, "Agence Sud", null, "Tunis")], none);
    expect(p.insert.map((r) => r.line)).toEqual([2, 4]);
    expect(p.duplicates.map((d) => d.line)).toEqual([3]);
  });

  it("never adds a number on the « ne pas contacter » list", () => {
    const p = planImport([row(2, "A", "+21671000001")], { ...none, dnc: new Set(["+21671000001"]) });
    expect(p.insert).toEqual([]);
    expect(p.doNotContact).toEqual([{ line: 2, name: "A", phone: "+21671000001" }]);
  });
});

describe("shareOut", () => {
  const list = (n: number, gov: (i: number) => string | null) => Array.from({ length: n }, (_, i) => ({ id: `a${String(i).padStart(3, "0")}`, governorate: gov(i) }));
  const count = (m: Map<string, string>) => {
    const c: Record<string, number> = {};
    for (const v of m.values()) c[v] = (c[v] ?? 0) + 1;
    return c;
  };

  it("shares them in nearly equal parts", () => {
    const m = shareOut(list(10, () => "Sfax"), ["u1", "u2", "u3"]);
    expect(m.size).toBe(10);
    expect(count(m)).toEqual({ u1: 4, u2: 4, u3: 2 });
  });

  it("keeps a member's agencies together by governorate", () => {
    const govs = ["Sfax", "Sfax", "Sfax", "Sfax", "Tunis", "Tunis", "Tunis", "Tunis"];
    const m = shareOut(list(8, (i) => govs[i]), ["u1", "u2"]);
    const of = (u: string) => [...m.entries()].filter(([, v]) => v === u).map(([id]) => govs[Number(id.slice(1))]);
    expect(new Set(of("u1"))).toEqual(new Set(["Sfax"]));
    expect(new Set(of("u2"))).toEqual(new Set(["Tunis"]));
  });

  it("puts the ones with no governorate last, and does nothing without members or agencies", () => {
    expect(shareOut([{ id: "x", governorate: null }, { id: "y", governorate: "Sfax" }], ["u1", "u2"]).get("y")).toBe("u1");
    expect(shareOut([], ["u1"]).size).toBe(0);
    expect(shareOut(list(3, () => "Sfax"), []).size).toBe(0);
  });
});

describe("a call's result", () => {
  it("needs a reason to decline and a date to call back", () => {
    expect(resultBlockers({ kind: "declined" })).toEqual(["no_reason"]);
    expect(resultBlockers({ kind: "declined", reason: "price" })).toEqual([]);
    expect(resultBlockers({ kind: "declined", reason: "because" })).toEqual(["no_reason"]);
    expect(resultBlockers({ kind: "callback" })).toEqual(["no_follow_up"]);
    expect(resultBlockers({ kind: "callback", followUpAt: "2026-11-20" })).toEqual([]);
    expect(resultBlockers({ kind: "no_answer" })).toEqual([]);
    expect(resultBlockers({ kind: "interested" })).toEqual([]);
  });

  it("moves the agency where the answer says", () => {
    expect(patchForResult({ kind: "no_answer" })).toMatchObject({ status: "contacted", outcome: "no_answer" });
    expect(patchForResult({ kind: "callback", followUpAt: "d" })).toMatchObject({ status: "contacted", outcome: "callback", follow_up_at: "d" });
    expect(patchForResult({ kind: "info_sent" })).toMatchObject({ status: "contacted", outcome: "info_sent" });
    expect(patchForResult({ kind: "interested" })).toMatchObject({ status: "interested", outcome: null });
    expect(patchForResult({ kind: "declined", reason: "no_time", followUpAt: "d" })).toEqual({ status: "declined", outcome: null, decline_reason: "no_time", follow_up_at: null });
  });

  it("does not record on an agency that said no", () => {
    expect(canRecord("declined")).toBe(false);
    expect(canRecord("to_call")).toBe(true);
    expect(canRecord("interested")).toBe(true);
  });
});

describe("who works an agency", () => {
  it("is the member in charge, or the whole console", () => {
    expect(mayWorkAgency(null, "owner", { assigned_to: "m1" })).toBe(true);
    expect(mayWorkAgency(["prospection"], "m1", { assigned_to: "m1" })).toBe(true);
    expect(mayWorkAgency(["prospection"], "m1", { assigned_to: "m2" })).toBe(false);
    expect(mayWorkAgency(["prospection"], "m1", { assigned_to: null })).toBe(false);
  });
});

describe("stageOf", () => {
  it("puts what the site found before what the team recorded", () => {
    expect(stageOf({ status: "to_call", shop_id: null, first_posted_at: null })).toBe("to_call");
    expect(stageOf({ status: "interested", shop_id: null, first_posted_at: null })).toBe("interested");
    expect(stageOf({ status: "interested", shop_id: "s", first_posted_at: null })).toBe("signed_up");
    expect(stageOf({ status: "to_call", shop_id: "s", first_posted_at: "2026-11-18" })).toBe("posted");
  });
});

describe("the day's figures", () => {
  it("counts what each member did, and credits what the site found to the member in charge", () => {
    const f = countAgencyFigures([
      { kind: "contacted", actorId: "m1", assignedTo: "m1" },
      { kind: "no_answer", actorId: "m1", assignedTo: "m1" },
      { kind: "contacted", actorId: "m1", assignedTo: "m1" },
      { kind: "interested", actorId: "m1", assignedTo: "m1" },
      { kind: "declined", actorId: "m2", assignedTo: "m2" },
      { kind: "contacted", actorId: "m2", assignedTo: "m2" },
      { kind: "signed_up", actorId: null, assignedTo: "m1" },
      { kind: "posted", actorId: null, assignedTo: "m1" },
      { kind: "signed_up", actorId: null, assignedTo: null },
    ]);
    const by = Object.fromEntries(f.map((x) => [x.actorId, x]));
    expect(by.m1).toEqual({ actorId: "m1", contacted: 2, reached: 1, noAnswer: 1, interested: 1, declined: 0, signedUp: 1, posted: 1 });
    expect(by.m2).toEqual({ actorId: "m2", contacted: 1, reached: 1, noAnswer: 0, interested: 0, declined: 1, signedUp: 0, posted: 0 });
    expect(f).toHaveLength(2);
    expect(agencyLine(by.m1)).toBe("2 · 1 · 1 · 2");
  });
});

describe("matchAgencyShops", () => {
  const ag = (id: string, over: Partial<{ phone: string | null; phone2: string | null; legal_id: string | null; shop_id: string | null }> = {}) =>
    ({ id, phone: null, phone2: null, legal_id: null, shop_id: null, ...over });
  const shop = (id: string, over: Partial<{ phone: string | null; legal_id: string | null; owner_id: string }> = {}) =>
    ({ id, phone: null, legal_id: null, owner_id: `o-${id}`, ...over });

  it("matches an agency to the agence that has its number, either of its two", () => {
    const m = matchAgencyShops(
      [ag("a1", { phone: "+21671000001" }), ag("a2", { phone: "+21671000009", phone2: "+21671000002" })],
      [shop("s1", { phone: "+21671000001" }), shop("s2", { phone: "216 71 000 002" })],
      new Map(),
    );
    expect(Object.fromEntries(m)).toEqual({ a1: "s1", a2: "s2" });
  });

  it("matches by the number of the account that owns the agence", () => {
    const m = matchAgencyShops([ag("a1", { phone: "+21698000001" })], [shop("s1", { phone: "+21671999999", owner_id: "u1" })], new Map([["u1", "+21698000001"]]));
    expect(m.get("a1")).toBe("s1");
  });

  it("matches by the register identifier, ignoring spaces and case", () => {
    const m = matchAgencyShops([ag("a1", { legal_id: "1234567 a" })], [shop("s1", { legal_id: "1234567A" })], new Map());
    expect(m.get("a1")).toBe("s1");
  });

  it("leaves an agency that already has its agence, and one that matches nothing", () => {
    const m = matchAgencyShops(
      [ag("a1", { phone: "+21671000001", shop_id: "old" }), ag("a2", { phone: "+21671000077" }), ag("a3")],
      [shop("s1", { phone: "+21671000001" })],
      new Map(),
    );
    expect(m.size).toBe(0);
  });
});

describe("the notes of a refusal", () => {
  it("keeps the reason first and what the member added after, and reads them back", () => {
    expect(declineNote("price", "trop cher")).toBe("price — trop cher");
    expect(declineNote("price", null)).toBe("price");
    expect(declineNote(null, "  ")).toBeNull();
    expect(declineNote(null, "juste une note")).toBe("juste une note");
    expect(splitDeclineNote("price — trop cher")).toEqual({ reason: "price", text: "trop cher" });
    expect(splitDeclineNote("price")).toEqual({ reason: "price", text: null });
    expect(splitDeclineNote("juste une note")).toEqual({ reason: null, text: "juste une note" });
    expect(splitDeclineNote(null)).toEqual({ reason: null, text: null });
  });
});

describe("the CSV model the team fills (public/downloads/agences-modele.csv)", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  const model = fs.readFileSync("public/downloads/agences-modele.csv", "utf8");

  it("has a column for every thing the import reads, each one recognised", () => {
    const r = readAgencyCsv(`${model}وكالة النجاح;98 765 432;صفاقس;الشرقية;شارع 1;www.najah.tn;https://www.facebook.com/najah;najah@example.tn;نعم`);
    expect(r.problems).toEqual([]);
    expect(r.columns.sort()).toEqual(["address", "city", "email", "facebook", "governorate", "licensed", "name", "phone", "website"]);
    expect(r.rows[0]).toMatchObject({ name: "وكالة النجاح", phone: "+21698765432", governorate: "Sfax", website: "https://www.najah.tn", facebook_url: "https://www.facebook.com/najah", email: "najah@example.tn", licensed: true });
  });

  it("holds the header only: nothing is invented for a person to import by mistake", () => {
    expect(readAgencyCsv(model).rows).toEqual([]);
    expect(model.replace(/^\uFEFF/, "").trim().split(/\r?\n/)).toHaveLength(1);
  });

  it("reads the Arabic names with the article that people write (الموقع, البريد)", () => {
    const r = readAgencyCsv("الاسم,الهاتف,الموقع,البريد\nA,98765432,a.tn,a@a.tn");
    expect(r.rows[0]).toMatchObject({ website: "https://a.tn", email: "a@a.tn" });
  });
});
