import { describe, it, expect } from "vitest";
import {
  categoryOf, columnOf, detectDelimiter, duplicateKey, governorateOf, interpretFile, interpretLine, modelFile,
  parseDate, parseFurnished, parseNumber, parseRooms, parseTable, parseYesNo, readFile,
  type AttributeDef, type ImportContext, type LeafCategory,
} from "./importRows";

const SLUGS: [string, string, string, string][] = [
  ["appartements", "Appartements", "شقق", "residential"],
  ["maisons", "Maisons", "منازل", "residential"],
  ["villas", "Villas", "فيلات", "residential"],
  ["terrain", "Terrains", "أراضي", "land"],
  ["fermes", "Fermes", "مزارع", "land"],
  ["locaux-commerciaux", "Locaux commerciaux", "محلات تجارية", "commercial"],
  ["bureaux", "Bureaux", "مكاتب", "commercial"],
  ["depots", "Dépôts", "مستودعات", "commercial"],
];
const LEAVES: LeafCategory[] = SLUGS.map(([slug, label_fr, label_ar, kind]) => ({ id: slug, slug, label_fr, label_ar, kind }));

const def = (category_id: string, field_key: string, data_type: string, required = false): AttributeDef => ({ category_id, field_key, data_type, required, deal_types: null });
const ATTRIBUTES: AttributeDef[] = [
  ...["appartements", "maisons", "villas"].flatMap((c) => [
    def(c, "area_sqm", "number", true), def(c, "rooms", "number", true), def(c, "bathrooms", "number"), def(c, "floor", "number"), def(c, "year_built", "number"),
  ]),
  def("appartements", "parking", "boolean"), def("appartements", "elevator", "boolean"),
  def("villas", "garden", "boolean"), def("villas", "pool", "boolean"),
  def("terrain", "area_sqm", "number", true), def("terrain", "buildable", "boolean"),
];

const ctx = (over: Partial<ImportContext> = {}): ImportContext => ({
  leaves: LEAVES,
  attributes: ATTRIBUTES,
  defaultGovernorate: "Sfax",
  defaultPhone: "+21658415500",
  contactName: "Agence Test",
  nouns: { appartements: "Appartement", villas: "Villa", maisons: "Maison", terrain: "Terrain" },
  forRent: (c) => `${c} à louer`,
  locale: "fr",
  existing: new Set(),
  ...over,
});

function rows(text: string, c: ImportContext = ctx()) {
  const file = readFile(text);
  if (!file.ok) throw new Error(`file refused: ${file.error}`);
  return interpretFile(file, c);
}

describe("parseTable", () => {
  it("reads a French Excel file: semicolons, a BOM, quotes and a line break inside a cell", () => {
    const t = parseTable('﻿Titre;Prix\r\n"Villa; vue ""mer""";250000\r\n"deux\nlignes";1\r\n');
    expect(t).toEqual([["Titre", "Prix"], ['Villa; vue "mer"', "250000"], ["deux\nlignes", "1"]]);
  });

  it("reads lines pasted from Excel (tabs) and a comma file", () => {
    expect(parseTable("Type\tPrix\nVilla\t1 200 000")).toEqual([["Type", "Prix"], ["Villa", "1 200 000"]]);
    expect(parseTable("Type,Prix\nVilla,1200")).toEqual([["Type", "Prix"], ["Villa", "1200"]]);
  });

  it("drops empty lines and keeps a last line with no line break", () => {
    expect(parseTable("a;b\n\n;\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("detects the delimiter from the header, not from a decimal comma", () => {
    expect(detectDelimiter("Type;Prix\nVilla;1,5")).toBe(";");
    expect(detectDelimiter('"Prix, TND",Type\n1,2')).toBe(",");
  });
});

describe("columns", () => {
  it("knows the headers an agence writes", () => {
    expect(columnOf("Prix (TND)")).toBe("price");
    expect(columnOf("  SURFACE m² ")).toBe("area_sqm");
    expect(columnOf("Pièces")).toBe("rooms");
    expect(columnOf("S+")).toBe("rooms");
    expect(columnOf("Délégation")).toBe("delegation");
    expect(columnOf("Titre foncier")).toBe("titled");
    expect(columnOf("Titre")).toBe("title");
    expect(columnOf("السعر")).toBe("price");
    expect(columnOf("Référence interne")).toBeNull();
  });
});

describe("values", () => {
  it("reads prices the way they are typed", () => {
    expect(parseNumber("250 000")).toBe(250000);
    expect(parseNumber("250.000 DT")).toBe(250000);
    expect(parseNumber("250,000")).toBe(250000);
    expect(parseNumber("1 200 000 TND")).toBe(1200000);
    expect(parseNumber("1,5")).toBe(1.5);
    expect(parseNumber("120 m²")).toBe(120);
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("abc")).toBeNull();
  });

  it("reads S+N as N rooms", () => {
    expect(parseRooms("S+2")).toBe(2);
    expect(parseRooms("s + 3")).toBe(3);
    expect(parseRooms("4 pièces")).toBe(4);
    expect(parseRooms("studio")).toBeNull();
  });

  it("reads yes and no, a tick, and tells an unclear answer from silence", () => {
    expect(parseYesNo("Oui")).toBe(true);
    expect(parseYesNo("x")).toBe(true);
    expect(parseYesNo("✓")).toBe(true);
    expect(parseYesNo("non")).toBe(false);
    expect(parseYesNo("")).toBeNull();
    expect(parseYesNo("peut-être")).toBeUndefined();
  });

  it("reads furnished, and dates in the French order", () => {
    expect(parseFurnished("Meublé")).toBe("furnished");
    expect(parseFurnished("non meublé")).toBe("unfurnished");
    expect(parseFurnished("semi-meublé")).toBe("semi");
    expect(parseDate("15/11/2026")).toBe("2026-11-15");
    expect(parseDate("2026-11-15")).toBe("2026-11-15");
    expect(parseDate("31/02/2026")).toBeNull();
  });

  it("finds the category a cell means", () => {
    const id = (s: string) => categoryOf(s, LEAVES)?.slug ?? null;
    expect(id("Appartement")).toBe("appartements");
    expect(id("appartement S+2")).toBe("appartements");
    expect(id("Studio")).toBe("appartements");
    expect(id("Villa jumelée")).toBe("villas");
    expect(id("Maison")).toBe("maisons");
    expect(id("Terrain")).toBe("terrain");
    expect(id("Lotissement")).toBe("terrain");
    expect(id("Local commercial")).toBe("locaux-commerciaux");
    expect(id("Bureau")).toBe("bureaux");
    expect(id("Dépôt")).toBe("depots");
    expect(id("شقة")).toBe("appartements");
    expect(id("Château")).toBeNull();
    expect(id("")).toBeNull();
  });

  it("finds a governorate by French or Arabic name", () => {
    expect(governorateOf("sfax")).toBe("Sfax");
    expect(governorateOf("Gouvernorat de Sfax")).toBe("Sfax");
    expect(governorateOf("صفاقس")).toBe("Sfax");
    expect(governorateOf("Gabes")).toBe("Gabès");
    expect(governorateOf("La Manouba")).toBe("Manouba");
    expect(governorateOf("Paris")).toBeNull();
  });
});

describe("readFile", () => {
  it("refuses a file without the columns every annonce needs, naming them", () => {
    const f = readFile("Titre;Ville\nA;B");
    expect(f).toMatchObject({ ok: false, error: "missing_columns" });
    expect(f.ok === false && f.missing).toEqual(["type", "price", "area_sqm"]);
  });

  it("refuses an empty file and a file with a header only", () => {
    expect(readFile("")).toMatchObject({ ok: false, error: "empty" });
    expect(readFile("Type;Prix;Surface")).toMatchObject({ ok: false, error: "no_rows" });
  });

  it("ignores columns it does not know", () => {
    expect(readFile("Réf;Type;Prix;Surface\nX1;Villa;1;1").ok).toBe(true);
  });
});

describe("one line", () => {
  const HEAD = "Type;Prix;Surface;Pièces;Gouvernorat;Délégation;Transaction;Parking;Caution;Disponible";

  it("becomes a draft with the form's own body", () => {
    const [r] = rows(`${HEAD}\nAppartement;320 000;120;S+3;Sfax;Sakiet Ezzit;Vente;oui;;`);
    expect(r.status).toBe("ok");
    expect(r.body).toMatchObject({
      category_id: "appartements",
      deal_type: "sale",
      price: 320000,
      price_on_request: false,
      governorate: "Sfax",
      delegation: "Sakiet Ezzit",
      contact_phone: "+21658415500",
      contact_name: "Agence Test",
      attributes: { area_sqm: 120, rooms: 3, parking: true },
    });
    expect(r.preview.title).toBe("Appartement S+3 · 120 m² · Sakiet Ezzit");
  });

  it("carries the rent facts of a rental, and a title that says so", () => {
    const [r] = rows(`${HEAD}\nVilla;1800;250;S+4;Sfax;;Location;;3600;01/12/2026`);
    expect(r.status).toBe("ok");
    expect(r.body).toMatchObject({ deal_type: "rent", deposit_amount: 3600, available_from: "2026-12-01" });
    expect(r.preview.title).toBe("Villa S+4 à louer · 250 m² · Sfax");
  });

  it("keeps the agence's governorate when the file has no column for it", () => {
    const [r] = rows("Type;Prix;Surface;Pièces\nMaison;200000;150;4");
    expect(r.body?.governorate).toBe("Sfax");
  });

  it("names what is wrong, line by line, and imports nothing from a bad line", () => {
    const out = rows(`${HEAD}\nChâteau;100000;100;3;Sfax;;;;;\nVilla;;100;3;Sfax;;;;;\nVilla;100000;;3;Sfax;;;;;\nVilla;100000;100;3;Paris;;;;;\nVilla;abc;100;3;Sfax;;;;;\nVilla;100000;100;3;Sfax;;Echange;;;`);
    expect(out.map((r) => r.status)).toEqual(Array(6).fill("error"));
    expect(out.map((r) => r.errors[0].code)).toEqual(["type_unknown", "price_missing", "answer_missing", "governorate_unknown", "price_invalid", "deal_unknown"]);
    expect(out.map((r) => r.line)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(out.every((r) => !r.body)).toBe(true);
  });

  it("warns about a price that looks like a typo, without refusing it", () => {
    const [sale] = rows("Type;Prix;Surface;Pièces\nMaison;250;150;4");
    expect(sale.status).toBe("ok");
    expect(sale.warnings.map((w) => w.code)).toEqual(["price_low"]);
    const [rent] = rows("Transaction;Type;Prix;Surface;Pièces\nLocation;Villa;180000;250;5");
    expect(rent.warnings.map((w) => w.code)).toEqual(["price_high"]);
  });

  it("accepts a price on request", () => {
    const [r] = rows("Type;Prix;Surface;Pièces\nVilla;sur demande;300;5");
    expect(r.status).toBe("ok");
    expect(r.body).toMatchObject({ price: null, price_on_request: true });
  });

  it("refuses an answer the form would drop, and one it cannot read", () => {
    const [bad] = rows("Type;Prix;Surface;Pièces;Parking\nAppartement;100000;99999999;3;peut-être");
    expect(bad.errors.map((e) => e.code).sort()).toEqual(["answer_invalid", "answer_unclear"]);
  });

  it("uses the line's own phone, title and description when it has them", () => {
    const [r] = rows("Titre;Type;Prix;Surface;Pièces;Téléphone;Description\nBelle villa vue mer;Villa;900000;400;6;98 123 456;Tout confort");
    expect(r.preview.title).toBe("Belle villa vue mer");
    expect(r.body).toMatchObject({ contact_phone: "98123456", description: "Tout confort" });
  });
});

describe("duplicates", () => {
  const TEXT = "Type;Prix;Surface;Pièces\nVilla;500000;300;5\nVilla;500000;300;5\nVilla;510000;300;5";

  it("counts a repeated line once", () => {
    expect(rows(TEXT).map((r) => r.status)).toEqual(["ok", "duplicate", "ok"]);
  });

  it("skips what the agence already has", () => {
    const existing = new Set([duplicateKey("Villa S+5 · 300 m² · Sfax", 500000, 300, "Sfax")]);
    expect(rows(TEXT, ctx({ existing })).map((r) => r.status)).toEqual(["duplicate", "duplicate", "ok"]);
  });
});

describe("the model file", () => {
  it("opens as it was written: every line of it is a valid annonce", () => {
    const out = rows(modelFile());
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.status)).toEqual(["ok", "ok"]);
    expect(out[1].body).toMatchObject({ deal_type: "rent", min_lease_months: 12, furnished: "unfurnished" });
    expect(interpretLine({ columns: new Map() }, { line: 2, cells: [] }, ctx()).status).toBe("error");
  });
});
