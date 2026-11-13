/**
 * Prospection (0218) — the owners the team brings to Mazed Immo. Pure: the
 * console's screens, its API routes and the tests read the same rules.
 *
 * A lead is one Facebook post found by a member of the team. It goes through
 * four steps, and only the owner's yes opens the last one:
 *
 *   to_contact → contacted → confirmed → online      (or declined, at any step)
 *
 *   • to_contact  the post was pasted, the assistant read a draft from it;
 *   • contacted   someone wrote to the owner (WhatsApp, SMS, a call…);
 *   • confirmed   the owner said yes, in words the team kept: from then there
 *                 is an account on their number and a draft annonce in it;
 *   • online      the photos are in, the annonce went through the usual
 *                 moderation, and the owner was told by SMS.
 *
 * Nothing is published before the yes, and nothing here invents a fact: the
 * draft only holds what the post said.
 */
import type { ListingDraft } from "@/lib/ai/listing";
import type { ListingBody } from "@/lib/listings/input";
import { latinDigits } from "@/lib/moderation/rules";

export const LEAD_STATUSES = ["to_contact", "contacted", "confirmed", "online", "declined"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const CHANNELS = ["whatsapp", "sms", "call", "messenger", "other"] as const;
export type Channel = (typeof CHANNELS)[number];

/** Where a lead stands while it is not a yes. */
export const OUTCOMES = ["no_answer", "thinking", "refused", "wrong_number"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const EVENT_KINDS = [
  "created", "contacted", "no_answer", "thinking", "refused", "wrong_number",
  "confirmed", "published", "sms", "note", "assigned", "broker",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export function isStatus(v: unknown): v is LeadStatus {
  return typeof v === "string" && (LEAD_STATUSES as readonly string[]).includes(v);
}
export function isChannel(v: unknown): v is Channel {
  return typeof v === "string" && (CHANNELS as readonly string[]).includes(v);
}

/** The attestation the owner's yes stands for (listings.seller_attestation_version). */
export const TEAM_ATTESTATION = "v1-team";

// ── Phone numbers ───────────────────────────────────────────────────────────

/**
 * A Tunisian number as +216XXXXXXXX, from however it was written: with or
 * without the country code, 00216, spaces, dots or dashes between the pairs,
 * Arabic-Indic digits. Null when it is not eight digits starting like a
 * Tunisian line (2, 3, 4, 5, 7 or 9) — 8x numbers are service lines, not owners.
 */
export function normalizePhone(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let d = latinDigits(input).replace(/\D/g, "");
  if (d.startsWith("00216")) d = d.slice(5);
  else if (d.startsWith("216") && d.length === 11) d = d.slice(3);
  return /^[234579]\d{7}$/.test(d) ? `+216${d}` : null;
}

/** A number written in a post: optional country code, then 8 digits in pairs or triples. */
const PHONE_IN_TEXT = /(?<![\d])(?:(?:\+|00)?216[\s.\-]*)?[234579](?:[\s.\-]?\d){7}(?![\d])/g;

/**
 * Every Tunisian number a post carries, normalised and in order of appearance,
 * each once. A price (« 350 000 ») or a surface never has eight digits, and
 * a run of more than eight is not read as a number at all.
 */
export function extractPhones(text: string): string[] {
  const out: string[] = [];
  for (const m of latinDigits(text).matchAll(PHONE_IN_TEXT)) {
    const p = normalizePhone(m[0]);
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

// ── Messages ────────────────────────────────────────────────────────────────

/**
 * A template with {name}-style holes filled in. A hole with nothing to put in
 * it is dropped, and the punctuation around it tidied (« Bonjour , » → « Bonjour, »).
 */
export function fillTemplate(template: string, vars: Record<string, string | null | undefined>): string {
  return template
    .replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] ?? "").trim())
    .replace(/[ \t]+/g, " ")
    .replace(/ +([,.،:;!?؟])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .trim();
}

// ── The draft ───────────────────────────────────────────────────────────────

/** A stored draft read back safely: jsonb can hold anything, and the team edits it by hand. */
export function readDraft(raw: unknown): ListingDraft {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const num = (v: unknown, min: number, max: number) => {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  };
  const legal: ListingDraft["legal"] = {};
  const l = (r.legal && typeof r.legal === "object" ? r.legal : {}) as Record<string, unknown>;
  for (const k of ["titled", "buildable", "serviced"] as const) if (typeof l[k] === "boolean") legal[k] = l[k] as boolean;
  const furnished = r.furnished;
  return {
    deal: r.deal === "rent" ? "rent" : "sale",
    categorySlug: str(r.categorySlug, 60),
    governorate: str(r.governorate, 60),
    delegation: str(r.delegation, 80),
    price: num(r.price, 0, 1_000_000_000),
    areaSqm: num(r.areaSqm, 1, 10_000_000),
    rooms: num(r.rooms, 0, 50),
    bathrooms: num(r.bathrooms, 0, 20),
    floor: num(r.floor, 0, 100),
    levels: num(r.levels, 1, 20),
    floorOnly: r.floorOnly === true,
    furnished: furnished === "furnished" || furnished === "semi" || furnished === "unfurnished" ? furnished : null,
    deposit: num(r.deposit, 0, 1_000_000),
    charges: num(r.charges, 0, 100_000),
    availableFrom: str(r.availableFrom, 10),
    minLeaseMonths: num(r.minLeaseMonths, 1, 120),
    legal,
    title: str(r.title, 140),
    description: str(r.description, 4000),
    questions: (Array.isArray(r.questions) ? r.questions : [])
      .map((q) => str(q, 160))
      .filter((q): q is string => !!q)
      .slice(0, 5),
  };
}

/**
 * The body the publish form would have sent for this draft — read by the same
 * `listingFields` as every other annonce, so the team's annonces carry exactly
 * the columns a seller's would.
 */
export function draftToListingBody(
  d: ListingDraft,
  o: { categoryId: string; contactName: string | null; contactPhone: string },
): ListingBody {
  const attributes: Record<string, number | boolean> = {};
  if (d.areaSqm != null) attributes.area_sqm = d.areaSqm;
  if (d.rooms != null) attributes.rooms = d.rooms;
  if (d.bathrooms != null) attributes.bathrooms = d.bathrooms;
  if (d.floor != null) attributes.floor = d.floor;
  if (d.levels != null) attributes.levels = d.levels;
  if (d.floorOnly) {
    attributes.floor_only = true;
    attributes.levels = 1;
  }
  for (const [k, v] of Object.entries(d.legal)) if (typeof v === "boolean") attributes[k] = v;

  const body: ListingBody = {
    category_id: o.categoryId,
    title: d.title,
    description: d.description,
    price: d.price,
    price_on_request: d.price == null,
    negotiable: true,
    deal_type: d.deal,
    governorate: d.governorate,
    delegation: d.delegation,
    attributes,
    contact_name: o.contactName,
    contact_phone: o.contactPhone,
    contact_whatsapp: o.contactPhone,
    show_phone: true,
    attestation_version: TEAM_ATTESTATION,
  };
  if (d.deal === "rent") {
    body.deposit_amount = d.deposit;
    body.charges_amount = d.charges;
    body.furnished = d.furnished;
    body.available_from = d.availableFrom;
    body.min_lease_months = d.minLeaseMonths;
  }
  return body;
}

// ── What stands in the way ──────────────────────────────────────────────────

export type ConfirmBlocker =
  | "wrong_step" | "no_phone" | "do_not_contact" | "no_category" | "no_governorate" | "no_title" | "no_reply" | "no_channel";

/**
 * Why a lead cannot be marked « the owner said yes » yet. The reply is what
 * the owner wrote or said: the team pastes it, and it is the proof of the yes.
 */
export function confirmBlockers(input: {
  status: LeadStatus;
  phone: string | null;
  doNotContact: boolean;
  draft: ListingDraft;
  reply: string;
  channel: Channel | null;
}): ConfirmBlocker[] {
  const out: ConfirmBlocker[] = [];
  if (input.status !== "to_contact" && input.status !== "contacted") out.push("wrong_step");
  if (!input.phone) out.push("no_phone");
  if (input.doNotContact) out.push("do_not_contact");
  if (!input.draft.categorySlug) out.push("no_category");
  if (!input.draft.governorate) out.push("no_governorate");
  if (!input.draft.title) out.push("no_title");
  if (input.reply.trim().length < 2) out.push("no_reply");
  if (!input.channel) out.push("no_channel");
  return out;
}

export type PublishBlocker = "wrong_step" | "no_listing" | "photos" | "photos_not_checked" | "no_price";

/** Why a confirmed lead cannot go online yet. `minPhotos` is the site's own minimum (moderation_min_photos). */
export function publishBlockers(input: {
  status: LeadStatus;
  hasListing: boolean;
  photoCount: number;
  minPhotos: number;
  photosChecked: boolean;
  draft: ListingDraft;
}): PublishBlocker[] {
  const out: PublishBlocker[] = [];
  if (input.status !== "confirmed") out.push("wrong_step");
  if (!input.hasListing) out.push("no_listing");
  if (input.photoCount < Math.max(1, input.minPhotos)) out.push("photos");
  if (!input.photosChecked) out.push("photos_not_checked");
  if (input.draft.price == null) out.push("no_price");
  return out;
}

/** How a lead moves when something is recorded on it. */
export function statusAfter(current: LeadStatus, kind: EventKind): LeadStatus {
  if (current === "online") return current;
  switch (kind) {
    case "contacted":
    case "no_answer":
    case "thinking":
      return current === "to_contact" ? "contacted" : current;
    case "refused":
    case "wrong_number":
      return current === "confirmed" ? current : "declined";
    case "confirmed":
      return "confirmed";
    case "published":
      return "online";
    default:
      return current;
  }
}

/** Contacts a member may still make today (the daily cap protects the number we write from). */
export function contactsLeft(cap: number, madeToday: number): number {
  return Math.max(0, cap - madeToday);
}

/** The start of today in Tunisia (UTC+1, no daylight saving), as an ISO instant. */
export function startOfTunisiaDay(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + 3_600_000);
  const day = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return new Date(day - 3_600_000).toISOString();
}

/** The one line that names the property in a message: the title, else what the draft says. */
export function propertyLine(d: ListingDraft): string {
  if (d.title) return d.title;
  return [d.delegation ?? d.governorate, d.areaSqm != null ? `${d.areaSqm} m²` : null].filter(Boolean).join(" · ");
}

/** A path the owner's folder could hold, as the publish form writes them. */
export function photoPathOf(sellerId: string, path: unknown): string | null {
  if (typeof path !== "string" || path.length > 300) return null;
  const escaped = sellerId.replace(/[^a-f0-9-]/gi, "");
  return new RegExp(`^${escaped}/annonce-[0-9]+-[0-9]+-[0-9]+\\.[a-z0-9]{1,5}$`).test(path) ? path : null;
}

// ── The daily reminder and the team's figures ───────────────────────────────

/** What is waiting for one member of the team (src/lib/prospection/daily.ts). */
export type Digest = { followUps: number; yes: number; noSms: number };

export function digestIsEmpty(d: Digest): boolean {
  return d.followUps + d.yes + d.noSms === 0;
}

/** The notice's own words in French (the bell translates it from the kind and its variables). */
export function digestText(d: Digest): string {
  return [
    d.followUps > 0 ? `${d.followUps} à relancer` : null,
    d.yes > 0 ? `${d.yes} « oui » à finaliser` : null,
    d.noSms > 0 ? `${d.noSms} SMS à renvoyer` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Leads that ended before this instant lose the post's text and the poster's name. */
export function retentionCutoff(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - Math.max(1, days) * 86_400_000).toISOString();
}

/** A share as a whole percent, or null when there is nothing to divide by. */
export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

/** The ranges the board's figures can be read over, in days (1 = today). */
export const RANGES = [1, 7, 30] as const;
export type Range = (typeof RANGES)[number];

export function asRange(v: unknown): Range {
  const n = Number(v);
  return (RANGES as readonly number[]).includes(n) ? (n as Range) : 7;
}

/** Where a range starts: today's midnight in Tunisia, or that many days back from it. */
export function rangeStart(range: Range, now: Date = new Date()): string {
  const today = Date.parse(startOfTunisiaDay(now));
  return new Date(today - (range - 1) * 86_400_000).toISOString();
}

/** How long a « oui » may wait for its photos before the member is reminded. */
const YES_WAITING_HOURS = 24;

export type WaitingRow = {
  id: string;
  status: string;
  assigned_to: string | null;
  created_by: string | null;
  confirmed_by: string | null;
  follow_up_at: string | null;
  confirmed_at: string | null;
  sms_sent_at: string | null;
  published_at: string | null;
};

/**
 * What is waiting for each member of the team: owners to write to again (a
 * follow-up date that has come), « oui » whose photos are still missing after a
 * day, and annonces online whose SMS never left. Each goes to the lead's
 * responsible member (else whoever made it).
 */
export function digestsOf(rows: readonly WaitingRow[], now: Date = new Date()): Map<string, Digest> {
  const out = new Map<string, Digest>();
  const bump = (member: string | null, key: keyof Digest) => {
    if (!member) return;
    const d = out.get(member) ?? { followUps: 0, yes: 0, noSms: 0 };
    d[key]++;
    out.set(member, d);
  };
  for (const r of rows) {
    const member = r.assigned_to ?? r.confirmed_by ?? r.created_by;
    if ((r.status === "to_contact" || r.status === "contacted") && r.follow_up_at && Date.parse(r.follow_up_at) <= now.getTime()) {
      bump(member, "followUps");
    } else if (r.status === "confirmed" && r.confirmed_at && Date.parse(r.confirmed_at) <= now.getTime() - YES_WAITING_HOURS * 3_600_000) {
      bump(member, "yes");
    } else if (r.status === "online" && !r.sms_sent_at && r.published_at && Date.parse(r.published_at) <= now.getTime() - 3_600_000) {
      bump(member, "noSms");
    }
  }
  return out;
}
