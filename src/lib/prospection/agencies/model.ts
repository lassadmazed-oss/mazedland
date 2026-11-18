/**
 * The agencies of Tunisia, as the Prospection team works them (0229).
 *
 * Pure rules, no database: the list's vocabulary, how a CSV becomes rows, what
 * an import does with each row, how the unassigned agencies are shared out
 * among the team, what each answer a call can get does to an agency, and how a
 * day's events become the figures of the evening report. src/lib/prospection/
 * agencies/server.ts does the reading and writing.
 */
import { extractPhones, normalizePhone } from "../model";
import { TUNISIAN_GOVERNORATES, governorateLabel, type TunisianGovernorate } from "@/lib/tunisia";

// ── Vocabulary ──────────────────────────────────────────────────────────────

/** Where an agency stands in the team's work. « Signed up » and « posted » are not here: the site finds them (see stageOf). */
export const AGENCY_STATUSES = ["to_call", "contacted", "interested", "declined"] as const;
export type AgencyStatus = (typeof AGENCY_STATUSES)[number];

/** The last answer while the agency is not decided. */
export const AGENCY_OUTCOMES = ["no_answer", "callback", "info_sent"] as const;
export type AgencyOutcome = (typeof AGENCY_OUTCOMES)[number];

/** Why an agency said no: a list, so the reasons can be counted after a month. */
export const DECLINE_REASONS = ["price", "no_time", "other_platform", "not_interested", "closed_down", "wrong_number", "other"] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];

export const AGENCY_SOURCES = ["csv", "manual", "extension", "google", "chamber", "other"] as const;
export type AgencySource = (typeof AGENCY_SOURCES)[number];

export const AGENCY_EVENT_KINDS = [
  "created", "imported", "contacted", "no_answer", "callback", "info_sent",
  "interested", "declined", "assigned", "note", "reopened", "signed_up", "posted",
] as const;
export type AgencyEventKind = (typeof AGENCY_EVENT_KINDS)[number];

/** What a call can be recorded as. */
export const AGENCY_RESULTS = ["no_answer", "callback", "info_sent", "interested", "declined"] as const;
export type AgencyResult = (typeof AGENCY_RESULTS)[number];

export function isResult(v: unknown): v is AgencyResult {
  return typeof v === "string" && (AGENCY_RESULTS as readonly string[]).includes(v);
}
export function isDeclineReason(v: unknown): v is DeclineReason {
  return typeof v === "string" && (DECLINE_REASONS as readonly string[]).includes(v);
}

/**
 * Where an agency is for the owner's eyes: the stages the SITE found
 * (signed up, then posted) come before what the team recorded.
 */
export type AgencyStage = "posted" | "signed_up" | AgencyStatus;

export function stageOf(a: { status: AgencyStatus; shop_id: string | null; first_posted_at: string | null }): AgencyStage {
  if (a.shop_id) return a.first_posted_at ? "posted" : "signed_up";
  return a.status;
}

// ── What a result does to an agency ─────────────────────────────────────────

export type ResultInput = { kind: AgencyResult; reason?: unknown; followUpAt?: string | null };

export type ResultBlocker = "no_reason" | "no_follow_up";

/** What is missing before a result can be recorded. */
export function resultBlockers(input: ResultInput): ResultBlocker[] {
  if (input.kind === "declined" && !isDeclineReason(input.reason)) return ["no_reason"];
  if (input.kind === "callback" && !input.followUpAt) return ["no_follow_up"];
  return [];
}

export type AgencyPatch = {
  status: AgencyStatus;
  outcome: AgencyOutcome | null;
  decline_reason: DeclineReason | null;
  follow_up_at: string | null;
};

/** The columns a result sets. `followUpAt` is an ISO date or null. */
export function patchForResult(input: ResultInput): AgencyPatch {
  const followUpAt = input.followUpAt ?? null;
  switch (input.kind) {
    case "no_answer":
      return { status: "contacted", outcome: "no_answer", decline_reason: null, follow_up_at: followUpAt };
    case "callback":
      return { status: "contacted", outcome: "callback", decline_reason: null, follow_up_at: followUpAt };
    case "info_sent":
      return { status: "contacted", outcome: "info_sent", decline_reason: null, follow_up_at: followUpAt };
    case "interested":
      return { status: "interested", outcome: null, decline_reason: null, follow_up_at: followUpAt };
    case "declined":
      return { status: "declined", outcome: null, decline_reason: isDeclineReason(input.reason) ? input.reason : "other", follow_up_at: null };
  }
}

/** An agency that said no is not worked again until someone reopens it. */
export function canRecord(status: AgencyStatus): boolean {
  return status !== "declined";
}

/** The member in charge of an agency, or the whole console: nobody else opens it. */
export function mayWorkAgency(scopes: readonly string[] | null, userId: string, agency: { assigned_to: string | null }): boolean {
  return scopes === null || agency.assigned_to === userId;
}

// ── Reading a CSV ───────────────────────────────────────────────────────────

/** Lower-case, no accents (Latin or Arabic marks), nothing but letters and digits: how names and headers are compared. */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ً-ْـ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Rows of cells. The separator is the one that appears most on the first line
 * (comma, semicolon or tab: Excel in French writes semicolons); quotes may hold
 * the separator, a newline and a doubled quote.
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const count = (ch: string) => {
    let n = 0;
    let quoted = false;
    for (const c of firstLine) {
      if (c === '"') quoted = !quoted;
      else if (c === ch && !quoted) n++;
    }
    return n;
  };
  const sep = ([",", ";", "\t"] as const).reduce((best, ch) => (count(ch) > count(best) ? ch : best), ",");

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === sep) {
      row.push(cell.trim()); cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell.trim()); cell = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

const HEADERS: Record<string, string[]> = {
  name: ["name", "nom", "agence", "agency", "raisonsociale", "denomination", "اسم", "الاسم", "الوكالة", "اسمالوكالة"],
  phone: ["phone", "telephone", "tel", "mobile", "gsm", "numero", "contact", "هاتف", "الهاتف", "رقمالهاتف", "رقم", "الرقم", "نمرة", "النمرة", "تيليفون", "التيليفون"],
  phone2: ["phone2", "telephone2", "tel2", "mobile2", "autretelephone", "هاتف2"],
  governorate: ["governorate", "gouvernorat", "gov", "region", "ولاية", "الولاية"],
  city: ["city", "ville", "delegation", "commune", "معتمدية", "المعتمدية", "مدينة"],
  address: ["address", "adresse", "عنوان", "العنوان"],
  website: ["website", "site", "siteweb", "url", "web", "موقع", "الموقع", "موقعالويب"],
  facebook: ["facebook", "fb", "pagefacebook", "فيسبوك"],
  email: ["email", "mail", "courriel", "بريد", "البريد", "البريدالالكتروني", "الايميل"],
  legalId: ["legalid", "rne", "identifiantunique", "matriculefiscale", "mf", "iduniq", "idunique"],
  licensed: ["licensed", "agree", "agreee", "agrement", "licence", "مرخصة", "مرخص", "رخصة", "الرخصة"],
  note: ["note", "remark", "remarque", "commentaire", "ملاحظة", "ملاحظات", "الملاحظات"],
};

export type ParsedAgency = {
  /** The line in the file (1 = the header), for the report of what was left out. */
  line: number;
  name: string;
  phone: string | null;
  phone2: string | null;
  governorate: TunisianGovernorate | null;
  city: string | null;
  address: string | null;
  website: string | null;
  facebook_url: string | null;
  email: string | null;
  legal_id: string | null;
  licensed: boolean | null;
  note: string | null;
};

export type ReadProblem = { line: number; why: "no_name" | "bad_phone" | "nothing_to_reach" };

const GOV_ALIASES: Record<string, TunisianGovernorate> = {
  lekef: "Kef", elkef: "Kef", lamanouba: "Manouba", gabes: "Gabès", medenine: "Médenine", beja: "Béja",
  kebili: "Kebili", sidibouzid: "Sidi Bouzid", benarous: "Ben Arous", tunisville: "Tunis",
};

const GOV_BY_FOLD: Map<string, TunisianGovernorate> = (() => {
  const m = new Map<string, TunisianGovernorate>();
  for (const g of TUNISIAN_GOVERNORATES) {
    m.set(fold(g), g);
    const ar = governorateLabel(g, "ar");
    if (ar && ar !== g) m.set(fold(ar), g);
  }
  for (const [k, v] of Object.entries(GOV_ALIASES)) m.set(k, v);
  return m;
})();

/** A governorate from a cell that is one: its name in French or Arabic, with or without accents. */
export function governorateFrom(text: string | null | undefined): TunisianGovernorate | null {
  if (!text) return null;
  return GOV_BY_FOLD.get(fold(text)) ?? null;
}

/** A governorate named somewhere in an address (« Rue de Marseille, Sfax »): the first whole word that is one. */
export function governorateIn(text: string | null | undefined): TunisianGovernorate | null {
  if (!text) return null;
  const words = text
    .normalize("NFD")
    .replace(/[̀-ًͯ-ْـ]/g, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    // « Sidi Bouzid », « Ben Arous »: try two words first.
    const two = i + 1 < words.length ? GOV_BY_FOLD.get(words[i] + words[i + 1]) : undefined;
    if (two) return two;
    const one = GOV_BY_FOLD.get(words[i]);
    if (one) return one;
  }
  return null;
}

function yesNo(v: string): boolean | null {
  const f = fold(v);
  if (!f) return null;
  if (["oui", "yes", "true", "1", "vrai", "نعم", "ايه", "y", "o"].includes(f)) return true;
  if (["non", "no", "false", "0", "faux", "لا", "n"].includes(f)) return false;
  return null;
}

function url(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : /^[\w-]+(\.[\w-]+)+/.test(s) ? `https://${s}` : null;
  return withScheme && withScheme.length <= 300 ? withScheme : null;
}

/** The rows of a CSV that an agency can be made from, and what was left out. */
export function readAgencyCsv(text: string): { rows: ParsedAgency[]; problems: ReadProblem[]; columns: string[] } {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], problems: [], columns: [] };
  const header = table[0].map((h) => fold(h));
  const index = (key: string) => header.findIndex((h) => HEADERS[key].includes(h));
  const col: Record<string, number> = {};
  for (const key of Object.keys(HEADERS)) col[key] = index(key);
  const columns = Object.keys(col).filter((k) => col[k] >= 0);

  const rows: ParsedAgency[] = [];
  const problems: ReadProblem[] = [];
  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const get = (key: string) => (col[key] >= 0 ? (cells[col[key]] ?? "").trim() : "");
    const name = get("name").slice(0, 160);
    if (!name) { problems.push({ line, why: "no_name" }); return; }

    const rawPhone = get("phone");
    const phones = extractPhones(`${rawPhone} ${get("phone2")}`);
    if (rawPhone && phones.length === 0 && !normalizePhone(rawPhone)) {
      // A number was given and it is not a Tunisian one: say so rather than lose it silently.
      if (!url(get("website")) && !url(get("facebook"))) { problems.push({ line, why: "bad_phone" }); return; }
    }

    const site = get("website");
    const fb = get("facebook");
    let website = url(site);
    let facebook = url(fb);
    // A Facebook page typed in the website column is a Facebook page.
    if (website && /facebook\.com|fb\.com/i.test(website)) { facebook = facebook ?? website; website = null; }

    if (phones.length === 0 && !website && !facebook) { problems.push({ line, why: "nothing_to_reach" }); return; }

    const addr = get("address").slice(0, 300) || null;
    const gov = governorateFrom(get("governorate")) ?? governorateIn(get("governorate")) ?? governorateIn(addr) ?? governorateIn(get("city"));
    rows.push({
      line,
      name,
      phone: phones[0] ?? null,
      phone2: phones[1] ?? null,
      governorate: gov,
      city: get("city").slice(0, 120) || null,
      address: addr,
      website,
      facebook_url: facebook,
      email: get("email").slice(0, 200) || null,
      legal_id: get("legalId").slice(0, 60) || null,
      licensed: yesNo(get("licensed")),
      note: get("note").slice(0, 200) || null,
    });
  });
  return { rows, problems, columns };
}

// ── What an import does with each row ───────────────────────────────────────

export type ImportPlan = {
  insert: ParsedAgency[];
  /** Already on the list (or twice in the file): the same number, or the same name in the same governorate when there is no number. */
  duplicates: { line: number; name: string; phone: string | null; where: "file" | "list" }[];
  /** On the « ne pas contacter » list: never added. */
  doNotContact: { line: number; name: string; phone: string }[];
  /** Added, but the team has no number to call: only a website or a page. */
  withoutNumber: number;
};

export const nameKey = (name: string, governorate: string | null) => `${fold(name)}|${governorate ?? ""}`;

export function planImport(
  rows: readonly ParsedAgency[],
  existing: { phones: ReadonlySet<string>; nameKeys: ReadonlySet<string>; dnc: ReadonlySet<string> },
): ImportPlan {
  const plan: ImportPlan = { insert: [], duplicates: [], doNotContact: [], withoutNumber: 0 };
  const seenPhones = new Set<string>();
  const seenKeys = new Set<string>();
  for (const r of rows) {
    if (r.phone && (existing.dnc.has(r.phone) || (r.phone2 && existing.dnc.has(r.phone2)))) {
      plan.doNotContact.push({ line: r.line, name: r.name, phone: r.phone });
      continue;
    }
    if (r.phone) {
      if (existing.phones.has(r.phone)) { plan.duplicates.push({ line: r.line, name: r.name, phone: r.phone, where: "list" }); continue; }
      if (seenPhones.has(r.phone)) { plan.duplicates.push({ line: r.line, name: r.name, phone: r.phone, where: "file" }); continue; }
      seenPhones.add(r.phone);
    } else {
      const key = nameKey(r.name, r.governorate);
      if (existing.nameKeys.has(key)) { plan.duplicates.push({ line: r.line, name: r.name, phone: null, where: "list" }); continue; }
      if (seenKeys.has(key)) { plan.duplicates.push({ line: r.line, name: r.name, phone: null, where: "file" }); continue; }
      seenKeys.add(key);
      plan.withoutNumber++;
    }
    plan.insert.push(r);
  }
  return plan;
}

// ── Sharing the list among the team ─────────────────────────────────────────

/**
 * The agencies without a member, shared among `memberIds` in nearly equal
 * parts and by governorate: they are put in order of governorate and cut into
 * runs, so each member gets a few governorates, not a scattering of every one
 * (a member who knows a region calls it better). A governorate cut in two
 * between members is the price of equal parts.
 */
export function shareOut(
  agencies: readonly { id: string; governorate: string | null }[],
  memberIds: readonly string[],
): Map<string, string> {
  const out = new Map<string, string>();
  if (agencies.length === 0 || memberIds.length === 0) return out;
  // Those with no governorate go last.
  const last = "￿";
  const ordered = [...agencies].sort((a, b) => (a.governorate ?? last).localeCompare(b.governorate ?? last) || a.id.localeCompare(b.id));
  const per = Math.ceil(ordered.length / memberIds.length);
  ordered.forEach((a, i) => out.set(a.id, memberIds[Math.min(memberIds.length - 1, Math.floor(i / per))]));
  return out;
}

// ── The day's figures ───────────────────────────────────────────────────────

export type AgencyFigures = {
  actorId: string;
  /** Calls or messages made. */
  contacted: number;
  /** Of those, the ones that ended in a conversation (not « no answer »). */
  reached: number;
  noAnswer: number;
  interested: number;
  declined: number;
  /** Agencies in the member's charge that opened an agence that day. */
  signedUp: number;
  /** … and that put an annonce online for the first time. */
  posted: number;
};

const REACHED = new Set<string>(["callback", "info_sent", "interested", "declined"]);

/**
 * The figures per member. `actorId` is who did it; for what the site finds
 * (signed_up, posted) nobody did anything, so it is the member in charge of the
 * agency (`assignedTo`) — an agency nobody holds counts for nobody.
 */
export function countAgencyFigures(
  events: readonly { kind: string; actorId: string | null; assignedTo: string | null }[],
): AgencyFigures[] {
  const by = new Map<string, AgencyFigures>();
  const get = (id: string) => {
    let f = by.get(id);
    if (!f) { f = { actorId: id, contacted: 0, reached: 0, noAnswer: 0, interested: 0, declined: 0, signedUp: 0, posted: 0 }; by.set(id, f); }
    return f;
  };
  for (const e of events) {
    const who = e.kind === "signed_up" || e.kind === "posted" ? e.assignedTo : e.actorId;
    if (!who) continue;
    const f = get(who);
    if (e.kind === "contacted") f.contacted++;
    else if (e.kind === "no_answer") f.noAnswer++;
    else if (e.kind === "interested") f.interested++;
    else if (e.kind === "declined") f.declined++;
    else if (e.kind === "signed_up") f.signedUp++;
    else if (e.kind === "posted") f.posted++;
    if (REACHED.has(e.kind)) f.reached++;
  }
  return [...by.values()];
}

/** « 12 · 4 · 3 · 1 » style line for the evening notice: calls · reached · interested · joined/posted. */
export function agencyLine(f: Pick<AgencyFigures, "contacted" | "reached" | "interested" | "signedUp" | "posted">): string {
  return `${f.contacted} · ${f.reached} · ${f.interested} · ${f.signedUp + f.posted}`;
}

/**
 * The note an event keeps for a refusal: the reason first (a key, translated on
 * screen), then what the member added. `splitDeclineNote` is its reading.
 */
export function declineNote(reason: DeclineReason | null | undefined, note: string | null | undefined): string | null {
  const extra = note?.trim();
  if (reason && extra) return `${reason} — ${extra}`;
  return reason ?? (extra || null);
}

export function splitDeclineNote(note: string | null | undefined): { reason: DeclineReason | null; text: string | null } {
  if (!note) return { reason: null, text: null };
  const [head, ...rest] = note.split(" — ");
  if (isDeclineReason(head)) return { reason: head, text: rest.join(" — ") || null };
  return { reason: null, text: note };
}

export function isAgencySource(v: unknown): v is AgencySource {
  return typeof v === "string" && (AGENCY_SOURCES as readonly string[]).includes(v);
}

// ── Which agence an agency opened ───────────────────────────────────────────

/**
 * The agences of the site that agencies on the list have opened: an agency is
 * its agence when one of its numbers is the agence's number, or the number of
 * the account that owns the agence, or when the national register identifier is
 * the same (spaces and case ignored). Only agencies with no agence yet are
 * matched. `ownerPhone` maps an account to its number (+216…).
 */
export function matchAgencyShops(
  agencies: readonly { id: string; phone: string | null; phone2: string | null; legal_id: string | null; shop_id: string | null }[],
  shops: readonly { id: string; phone: string | null; legal_id: string | null; owner_id: string }[],
  ownerPhone: ReadonlyMap<string, string>,
): Map<string, string> {
  const byPhone = new Map<string, string>();
  const byLegal = new Map<string, string>();
  const legalKey = (v: string) => v.replace(/\s+/g, "").toLowerCase();
  for (const s of shops) {
    for (const p of [normalizePhone(s.phone), ownerPhone.get(s.owner_id) ?? null]) if (p && !byPhone.has(p)) byPhone.set(p, s.id);
    if (s.legal_id && legalKey(s.legal_id)) byLegal.set(legalKey(s.legal_id), byLegal.get(legalKey(s.legal_id)) ?? s.id);
  }
  const out = new Map<string, string>();
  for (const a of agencies) {
    if (a.shop_id) continue;
    const hit =
      (a.phone && byPhone.get(a.phone)) ||
      (a.phone2 && byPhone.get(a.phone2)) ||
      (a.legal_id && legalKey(a.legal_id) && byLegal.get(legalKey(a.legal_id))) ||
      null;
    if (hit) out.set(a.id, hit);
  }
  return out;
}

/** « Amine 12 · 4 · 2 · 1 | Afef 0 · 0 · 0 · 0 »: each member's day on the list, for the evening notice. */
export function agencyReportText(
  rows: readonly ({ name: string } & Pick<AgencyFigures, "contacted" | "reached" | "interested" | "signedUp" | "posted">)[],
): string {
  return rows.map((r) => `${r.name} ${agencyLine(r)}`).join(" | ");
}
