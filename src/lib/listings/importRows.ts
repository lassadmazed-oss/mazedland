import { TUNISIAN_GOVERNORATES, governorateLabel } from "@/lib/tunisia";
import { asDealType, appliesTo, isoDay, type DealType } from "./deal";
import { attributeOutOfBounds, num, phone, titleTooShort, type ListingBody } from "./input";

/**
 * « Importer plusieurs annonces » (the agencies' bulk import, 2026-10-31).
 *
 * An agence already has its annonces in a spreadsheet, or on Tayara and
 * Mubawab; typing each again was the biggest thing between it and Mazed
 * Immo. A file (CSV saved from Excel, or lines pasted from it) becomes one
 * DRAFT per line: the facts are in, the photos and the seller's attestation
 * are not — those stay the agence's, from « Mes annonces », and the usual
 * moderation reads each annonce when it is sent.
 *
 * Pure: the route loads the categories and what the agence already has, this
 * reads the text and says what each line would become (or why not).
 */

/* ── Reading the file ──────────────────────────────────────────────────────── */

/** The delimiter Excel used: a tab (pasted lines), « ; » (French settings) or « , ». */
export function detectDelimiter(text: string): string {
  const first = text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  let quoted = false;
  const count: Record<string, number> = { "\t": 0, ";": 0, ",": 0 };
  for (const c of first) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && c in count) count[c] += 1;
  }
  // A tie goes to the tab, then « ; »: a comma is also a decimal mark.
  return (["\t", ";", ","] as const).reduce((best, d) => (count[d] > count[best] ? d : best), "\t" as string);
}

/** The cells of a delimited text: quotes, doubled quotes, line breaks inside a cell, a BOM. */
export function parseTable(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const delimiter = detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Lower case, no accents, no spaces or punctuation: « Prix (TND) » → « prixtnd ». Arabic letters stay. */
export function fold(s: string): string {
  // NFKD: « m² » becomes « m2 » as well as « é » losing its accent.
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, "");
}

/* ── The columns ───────────────────────────────────────────────────────────── */

export type ColumnKey =
  | "title" | "deal" | "type" | "price" | "negotiable" | "governorate" | "delegation" | "address" | "description"
  | "area_sqm" | "rooms" | "bathrooms" | "floor" | "year_built"
  | "phone" | "whatsapp" | "deposit" | "charges" | "furnished" | "available" | "min_lease"
  | "parking" | "elevator" | "air_conditioning" | "heating" | "garden" | "pool" | "buildable" | "titled" | "serviced";

/** What a header may be called, folded. The model file uses the first of each. */
const ALIASES: Record<ColumnKey, string[]> = {
  title: ["titre", "title", "intitule", "annonce", "designation", "objet", "عنوان"],
  deal: ["transaction", "operation", "typedetransaction", "ventelocation", "offre", "deal", "typeoperation", "معاملة", "نوعالمعاملة"],
  type: ["type", "typedebien", "typebien", "bien", "categorie", "category", "نوعالعقار", "صنف"],
  price: ["prix", "prixtnd", "prixdt", "price", "montant", "loyer", "loyermensuel", "prixloyer", "السعر", "ثمن"],
  negotiable: ["negociable", "negotiable", "adiscuter", "قابلللتفاوض"],
  governorate: ["gouvernorat", "governorate", "region", "wilaya", "ولاية"],
  delegation: ["delegation", "ville", "secteur", "quartier", "zone", "localite", "معتمدية", "منطقة", "حي"],
  address: ["adresse", "address", "rue"],
  description: ["description", "descriptif", "details", "detail", "commentaire", "remarques", "وصف"],
  area_sqm: ["surface", "superficie", "surfacem2", "superficiem2", "m2", "area", "surfacehabitable", "المساحة", "مساحة"],
  rooms: ["pieces", "nbpieces", "nombredepieces", "chambres", "nbchambres", "rooms", "s", "غرف"],
  bathrooms: ["sallesdebain", "sdb", "nbsdb", "salledebain", "bathrooms", "حمامات"],
  floor: ["etage", "floor", "الطابق"],
  year_built: ["annee", "anneeconstruction", "anneedeconstruction", "yearbuilt", "سنةالبناء"],
  phone: ["telephone", "tel", "phone", "mobile", "gsm", "contact", "هاتف"],
  whatsapp: ["whatsapp", "wa"],
  deposit: ["caution", "depotdegarantie", "deposit"],
  charges: ["charges", "chargesmensuelles"],
  furnished: ["meuble", "furnished", "ameublement", "مفروش"],
  available: ["disponible", "disponibilite", "disponiblele", "disponibleapartirde", "dispo", "available", "availablefrom"],
  min_lease: ["dureeminimale", "dureeminimum", "bailminimum", "dureeminbail", "minlease", "dureemin"],
  parking: ["parking", "garage", "parkinggarage"],
  elevator: ["ascenseur", "elevator"],
  air_conditioning: ["climatisation", "clim", "airconditioning"],
  heating: ["chauffage", "chauffagecentral", "heating"],
  garden: ["jardin", "garden"],
  pool: ["piscine", "pool"],
  buildable: ["constructible", "buildable"],
  titled: ["titrefoncier", "titled"],
  serviced: ["viabilise", "serviced"],
};

/** The headers of the model file, in order, as written for an agence. */
export const MODEL_HEADERS: Record<ColumnKey, string> = {
  title: "Titre",
  deal: "Transaction",
  type: "Type",
  price: "Prix",
  negotiable: "Négociable",
  governorate: "Gouvernorat",
  delegation: "Délégation",
  address: "Adresse",
  description: "Description",
  area_sqm: "Surface",
  rooms: "Pièces",
  bathrooms: "Salles de bain",
  floor: "Étage",
  year_built: "Année",
  phone: "Téléphone",
  whatsapp: "WhatsApp",
  deposit: "Caution",
  charges: "Charges",
  furnished: "Meublé",
  available: "Disponible",
  min_lease: "Durée minimale",
  parking: "Parking",
  elevator: "Ascenseur",
  air_conditioning: "Climatisation",
  heating: "Chauffage",
  garden: "Jardin",
  pool: "Piscine",
  buildable: "Constructible",
  titled: "Titre foncier",
  serviced: "Viabilisé",
};

const COLUMN_OF = new Map<string, ColumnKey>();
for (const [key, names] of Object.entries(ALIASES) as [ColumnKey, string[]][]) {
  COLUMN_OF.set(fold(MODEL_HEADERS[key]), key);
  for (const n of names) if (!COLUMN_OF.has(n)) COLUMN_OF.set(n, key);
}

/** The column a header names, or null for one we do not read (it is ignored, not refused). */
export function columnOf(header: string): ColumnKey | null {
  return COLUMN_OF.get(fold(header)) ?? null;
}

/** Without these, no line can become an annonce: the file is refused with their names. */
export const REQUIRED_COLUMNS: ColumnKey[] = ["type", "price", "area_sqm"];

/* ── The values ────────────────────────────────────────────────────────────── */

/** « 250 000 », « 250.000 », « 250 000 DT », « 1,5 »: a number, or null. A dot or comma followed by three digits is a thousands mark. */
export function parseNumber(raw: string): number | null {
  let s = raw
    .replace(/[\s  ]/g, "")
    .replace(/(tnd|dt|dinars?|د\.?ت|m2|m²|mètres?|metres?)/gi, "");
  if (s === "") return null;
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, "");
  else if (/^\d+,\d+$/.test(s)) s = s.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const YES = new Set(["oui", "o", "yes", "y", "1", "x", "vrai", "true", "نعم", "✓", "✔"]);
const NO = new Set(["non", "n", "no", "0", "faux", "false", "لا"]);

/** oui / non, or null when nothing was said. `undefined` for an answer that is neither. */
export function parseYesNo(raw: string): boolean | null | undefined {
  // A tick has no letters to fold: it is read as written.
  const s = fold(raw) || raw.trim().toLowerCase();
  if (s === "") return null;
  if (YES.has(s)) return true;
  if (NO.has(s)) return false;
  return undefined;
}

export function parseDeal(raw: string): DealType | null {
  const s = fold(raw);
  if (/(loc|louer|rent|كراء)/.test(s)) return "rent";
  if (/(vente|vend|sale|بيع)/.test(s)) return "sale";
  return null;
}

/** « S+2 » is 2, « 3 pièces » is 3: the number the form stores for the rooms. */
export function parseRooms(raw: string): number | null {
  const sPlus = raw.match(/s\s*\+\s*(\d+)/i);
  if (sPlus) return Number(sPlus[1]);
  const n = parseNumber(raw.replace(/pi[eè]ces?|chambres?/gi, ""));
  return n;
}

export function parseFurnished(raw: string): "furnished" | "semi" | "unfurnished" | null {
  const s = fold(raw);
  if (s === "") return null;
  if (/(non|vide|unfurnished|فارغ|sans)/.test(s)) return "unfurnished";
  if (/(semi|partiel)/.test(s)) return "semi";
  if (/(meuble|furnished|مفروش|oui)/.test(s)) return "furnished";
  return null;
}

/** « 15/11/2026 », « 15-11-2026 » or « 2026-11-15 » → « 2026-11-15 ». */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dmy) return isoDay(`${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`);
  return isoDay(s);
}

/** Words that name each leaf category; matched at the start of a word of the cell. */
const TYPE_WORDS: { slug: string; words: string[] }[] = [
  { slug: "locaux-commerciaux", words: ["local", "locaux", "magasin", "boutique", "commerce", "محل"] },
  { slug: "appartements", words: ["appart", "studio", "duplex", "triplex", "apt", "شقة", "شقه"] },
  { slug: "villas", words: ["villa", "فيلا"] },
  { slug: "maisons", words: ["maison", "dar", "house", "دار", "منزل"] },
  { slug: "fermes", words: ["ferme", "agricole", "farm", "ضيعة", "مزرعة"] },
  { slug: "terrain", words: ["terrain", "lot", "lotissement", "land", "أرض"] },
  { slug: "bureaux", words: ["bureau", "plateau", "office", "مكتب"] },
  { slug: "depots", words: ["depot", "entrepot", "hangar", "مستودع", "مخزن"] },
];

export type LeafCategory = { id: string; slug: string; label_fr: string; label_ar: string | null; kind: string };

/** The leaf category a « Type » cell means: its own name first, then the words people use. */
export function categoryOf(raw: string, leaves: readonly LeafCategory[]): LeafCategory | null {
  const s = fold(raw);
  if (s === "") return null;
  const exact = leaves.find((c) => [c.slug, c.label_fr, c.label_ar ?? ""].some((n) => n && fold(n) === s));
  if (exact) return exact;
  const words = raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9؀-ۿ]+/).filter(Boolean);
  for (const { slug, words: prefixes } of TYPE_WORDS) {
    if (words.some((w) => prefixes.some((p) => w.startsWith(fold(p))))) return leaves.find((c) => c.slug === slug) ?? null;
  }
  return null;
}

const GOVERNORATE_OF = new Map<string, string>();
for (const g of TUNISIAN_GOVERNORATES) {
  GOVERNORATE_OF.set(fold(g), g);
  GOVERNORATE_OF.set(fold(governorateLabel(g, "ar")), g);
}
GOVERNORATE_OF.set("lamanouba", "Manouba");
GOVERNORATE_OF.set("lekef", "Kef");
GOVERNORATE_OF.set("elkef", "Kef");
GOVERNORATE_OF.set("gabes", "Gabès");
GOVERNORATE_OF.set("mednine", "Médenine");

/** A governorate by its French or Arabic name, whatever the accents or the case. */
export function governorateOf(raw: string): string | null {
  const s = fold(raw.replace(/^(gouvernorat|governorate|ولاية)\s*(de|d'|of)?\s*/i, ""));
  return GOVERNORATE_OF.get(s) ?? null;
}

/* ── One line → one draft (or why not) ─────────────────────────────────────── */

/** A prix that is probably a typo: a sale under this, a monthly rent over it. */
export const SUSPICIOUS_SALE_BELOW = 5_000;
export const SUSPICIOUS_RENT_ABOVE = 30_000;

export type ImportIssue = { code: string; value?: string };

export type ImportRow = {
  /** The line in the file (the header is line 1). */
  line: number;
  status: "ok" | "error" | "duplicate";
  errors: ImportIssue[];
  warnings: ImportIssue[];
  preview: { title: string; deal: DealType; type: string | null; place: string; price: number | null; area: number | null };
  /** What the draft is made from (ok lines only): the same body the publish form sends. */
  body?: ListingBody;
};

export type AttributeDef = { category_id: string; field_key: string; label?: string; data_type: string; required: boolean; deal_types: readonly string[] | null };

export type ImportContext = {
  leaves: readonly LeafCategory[];
  attributes: readonly AttributeDef[];
  /** The agence's own governorate: used when the file has no column for it. */
  defaultGovernorate: string;
  /** The number the annonce shows when the line gives none (the agence's, else the account's). */
  defaultPhone: string | null;
  contactName: string | null;
  /** « Appartement », « Villa »… by category slug, and the « {category} à louer » wording, in the reader's language. */
  nouns: Record<string, string>;
  forRent: (category: string) => string;
  locale: string;
  /** The duplicate keys of what the agence already has. */
  existing: ReadonlySet<string>;
};

/** What makes two lines the same annonce: the title, the price, the surface, the governorate. */
export function duplicateKey(title: string, price: number | null, area: number | null, governorate: string): string {
  return [fold(title), price ?? "", area ?? "", fold(governorate)].join("|");
}

export type ParsedFile =
  | { ok: false; error: "empty" | "no_rows" | "missing_columns"; missing?: ColumnKey[] }
  | { ok: true; columns: Map<number, ColumnKey>; lines: { line: number; cells: string[] }[] };

/** The header row and the lines under it; the columns we do not know are left out. */
export function readFile(text: string): ParsedFile {
  const table = parseTable(text);
  if (table.length === 0) return { ok: false, error: "empty" };
  const columns = new Map<number, ColumnKey>();
  table[0].forEach((h, i) => {
    const key = columnOf(h);
    if (key && ![...columns.values()].includes(key)) columns.set(i, key);
  });
  const have = new Set(columns.values());
  const missing = REQUIRED_COLUMNS.filter((c) => !have.has(c));
  if (missing.length > 0) return { ok: false, error: "missing_columns", missing };
  if (table.length < 2) return { ok: false, error: "no_rows" };
  return { ok: true, columns, lines: table.slice(1).map((cells, i) => ({ line: i + 2, cells })) };
}

export function interpretLine(
  file: { columns: Map<number, ColumnKey> },
  line: { line: number; cells: string[] },
  ctx: ImportContext,
): ImportRow {
  const get = (key: ColumnKey): string => {
    for (const [i, k] of file.columns) if (k === key) return (line.cells[i] ?? "").trim();
    return "";
  };
  const has = (key: ColumnKey) => [...file.columns.values()].includes(key);
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];

  // Sale unless the line says rent; a word we cannot read is an error, not a guess.
  const dealRaw = get("deal");
  const dealParsed = dealRaw === "" ? null : parseDeal(dealRaw);
  if (dealRaw !== "" && !dealParsed) errors.push({ code: "deal_unknown", value: dealRaw });
  const deal = asDealType(dealParsed ?? "sale");
  const rent = deal === "rent";

  const typeRaw = get("type");
  const category = typeRaw === "" ? null : categoryOf(typeRaw, ctx.leaves);
  if (typeRaw === "") errors.push({ code: "type_missing" });
  else if (!category) errors.push({ code: "type_unknown", value: typeRaw });

  const govRaw = get("governorate");
  let governorate = ctx.defaultGovernorate;
  if (govRaw !== "") {
    const g = governorateOf(govRaw);
    if (g) governorate = g;
    else errors.push({ code: "governorate_unknown", value: govRaw });
  }

  const priceRaw = get("price");
  const onRequest = /^(sur demande|nous consulter|على الطلب)$/i.test(priceRaw.trim());
  const price = onRequest ? null : priceRaw === "" ? null : parseNumber(priceRaw);
  if (!onRequest) {
    if (priceRaw === "") errors.push({ code: "price_missing" });
    else if (price === null || num(price) === null || price <= 0) errors.push({ code: "price_invalid", value: priceRaw });
    else if (!rent && price < SUSPICIOUS_SALE_BELOW) warnings.push({ code: "price_low", value: String(price) });
    else if (rent && price > SUSPICIOUS_RENT_ABOVE) warnings.push({ code: "price_high", value: String(price) });
  }

  // The answers the category asks for, from the columns that carry them.
  const defs = category ? ctx.attributes.filter((a) => a.category_id === category.id && appliesTo(a.deal_types, deal)) : [];
  const attributes: Record<string, unknown> = {};
  const named = (def: AttributeDef) => MODEL_HEADERS[def.field_key as ColumnKey] ?? def.label ?? def.field_key;
  const unreadable = new Set<string>();
  for (const def of defs) {
    const key = def.field_key as ColumnKey;
    if (!has(key)) continue;
    const raw = get(key);
    if (raw === "") continue;
    if (def.data_type === "boolean") {
      const yn = parseYesNo(raw);
      if (yn === undefined) {
        unreadable.add(def.field_key);
        errors.push({ code: "answer_unclear", value: `${named(def)}: ${raw}` });
      } else if (yn !== null) attributes[def.field_key] = yn;
    } else {
      const n = def.field_key === "rooms" ? parseRooms(raw) : parseNumber(raw);
      if (n === null || attributeOutOfBounds(def.field_key, n)) {
        unreadable.add(def.field_key);
        errors.push({ code: "answer_invalid", value: `${named(def)}: ${raw}` });
      } else attributes[def.field_key] = n;
    }
  }
  // What the category requires and the line did not say (one already refused above is not asked twice).
  for (const def of defs) {
    if (def.required && attributes[def.field_key] === undefined && !unreadable.has(def.field_key)) {
      errors.push({ code: "answer_missing", value: named(def) });
    }
  }

  const delegation = get("delegation");
  const area = typeof attributes.area_sqm === "number" ? attributes.area_sqm : null;

  // A title nobody had to type: « Appartement S+2 · 120 m² · La Marsa », as in the form.
  let title = get("title");
  if (title === "" && category) {
    const noun = ctx.nouns[category.slug] ?? category.label_fr;
    const rooms = category.kind === "residential" && typeof attributes.rooms === "number" && attributes.rooms > 0 ? `S+${attributes.rooms}` : null;
    const kind = [noun, rooms].filter(Boolean).join(" ");
    const areaText = area ? `${new Intl.NumberFormat(ctx.locale === "ar" ? "ar-TN" : "fr-TN").format(area)} m²` : null;
    title = [rent ? ctx.forRent(kind) : kind, areaText, delegation || governorateLabel(governorate, ctx.locale)].filter(Boolean).join(" · ");
  }
  if (title !== "" && titleTooShort(title)) errors.push({ code: "title_short" });

  const preview = {
    title,
    deal,
    type: category ? (ctx.locale === "ar" && category.label_ar ? category.label_ar : category.label_fr) : null,
    place: [delegation, governorateLabel(governorate, ctx.locale)].filter(Boolean).join(", "),
    price: onRequest ? null : price,
    area,
  };
  if (errors.length > 0 || !category) return { line: line.line, status: "error", errors, warnings, preview };

  const key = duplicateKey(title, onRequest ? null : price, area, governorate);
  if (ctx.existing.has(key)) return { line: line.line, status: "duplicate", errors, warnings, preview };

  const negotiable = parseYesNo(get("negotiable"));
  const phoneGiven = phone(get("phone"));
  const body: ListingBody = {
    category_id: category.id,
    title,
    description: get("description") || null,
    price: onRequest ? null : price,
    price_on_request: onRequest,
    negotiable: negotiable === true,
    deal_type: deal,
    governorate,
    delegation: delegation || null,
    address: get("address") || null,
    attributes,
    contact_name: ctx.contactName,
    contact_phone: phoneGiven ?? ctx.defaultPhone,
    contact_whatsapp: phone(get("whatsapp")),
    show_phone: true,
  };
  if (rent) {
    const depositRaw = get("deposit");
    const chargesRaw = get("charges");
    const leaseRaw = get("min_lease");
    Object.assign(body, {
      deposit_amount: depositRaw === "" ? null : parseNumber(depositRaw),
      charges_amount: chargesRaw === "" ? null : parseNumber(chargesRaw),
      furnished: parseFurnished(get("furnished")),
      available_from: parseDate(get("available")),
      min_lease_months: leaseRaw === "" ? null : parseNumber(leaseRaw),
    });
  }
  return { line: line.line, status: "ok", errors, warnings, preview, body };
}

/** All the lines of a file, a repeated line (same title, price, surface, place) counted once. */
export function interpretFile(file: Extract<ParsedFile, { ok: true }>, ctx: ImportContext): ImportRow[] {
  const seen = new Set(ctx.existing);
  return file.lines.map((line) => {
    const row = interpretLine(file, line, { ...ctx, existing: seen });
    if (row.status === "ok" && row.body) {
      seen.add(duplicateKey(String(row.body.title), row.body.price_on_request === true ? null : (row.body.price as number | null), row.preview.area, String(row.body.governorate)));
    }
    return row;
  });
}

/** The model file an agence fills in: the header and two example lines, in the form Excel opens. */
export function modelFile(): string {
  const keys = Object.keys(MODEL_HEADERS) as ColumnKey[];
  const header = keys.map((k) => MODEL_HEADERS[k]);
  const row = (values: Partial<Record<ColumnKey, string>>) => keys.map((k) => values[k] ?? "");
  const lines = [
    header,
    row({ deal: "Vente", type: "Appartement", price: "320000", negotiable: "oui", governorate: "Sfax", delegation: "Sakiet Ezzit", description: "Appartement lumineux, proche des commodités.", area_sqm: "120", rooms: "S+3", bathrooms: "2", floor: "2", year_built: "2018", parking: "oui", elevator: "oui" }),
    row({ deal: "Location", type: "Villa", price: "1800", governorate: "Sfax", delegation: "Sfax Ville", area_sqm: "250", rooms: "S+4", bathrooms: "3", deposit: "3600", charges: "0", furnished: "non", available: "01/12/2026", min_lease: "12", garden: "oui", pool: "non" }),
  ];
  // « ; » and a BOM: what a French Excel opens as columns, accents included.
  return "﻿" + lines.map((r) => r.map((c) => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(";")).join("\r\n") + "\r\n";
}
