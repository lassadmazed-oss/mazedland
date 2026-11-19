import type { getServiceSupabase } from "@/lib/supabase/admin";
import type { AdminScopes } from "@/lib/admin/sections";
import { log } from "@/lib/log";
import { getSettings } from "@/lib/settings/server";
import { fillTemplate, normalizePhone, startOfTunisiaDay, dayBounds, type Channel } from "../model";
import {
  countAgencyFigures, declineNote, matchAgencyShops, mayWorkAgency, nameKey, patchForResult, planImport, shareOut, stageOf,
  type AgencyEventKind, type AgencyFigures, type AgencySource, type AgencyStage, type AgencyStatus,
  type AgencyOutcome, type DeclineReason, type ImportPlan, type ParsedAgency, type AgencyResult,
} from "./model";

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

const aLog = log.scope("prospection-agencies");

export const AGENCY_COLUMNS =
  "id, name, phone, phone2, governorate, city, address, website, facebook_url, email, legal_id, licensed, source, source_note, status, outcome, decline_reason, assigned_to, created_by, follow_up_at, last_contact_at, contact_count, shop_id, signed_up_at, first_posted_at, created_at, updated_at";

export type AgencyRow = {
  id: string;
  name: string;
  phone: string | null;
  phone2: string | null;
  governorate: string | null;
  city: string | null;
  address: string | null;
  website: string | null;
  facebook_url: string | null;
  email: string | null;
  legal_id: string | null;
  licensed: boolean | null;
  source: AgencySource;
  source_note: string | null;
  status: AgencyStatus;
  outcome: AgencyOutcome | null;
  decline_reason: DeclineReason | null;
  assigned_to: string | null;
  created_by: string | null;
  follow_up_at: string | null;
  last_contact_at: string | null;
  contact_count: number;
  shop_id: string | null;
  signed_up_at: string | null;
  first_posted_at: string | null;
  created_at: string;
  updated_at: string;
};

const chunks = <T,>(xs: readonly T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

// ── One agency ──────────────────────────────────────────────────────────────

export async function loadAgency(admin: Admin, id: string): Promise<AgencyRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await admin.from("prospect_agencies").select(AGENCY_COLUMNS).eq("id", id).maybeSingle();
  return (data as AgencyRow | null) ?? null;
}

/**
 * The agency a member may work: the whole console opens any; a member only the
 * ones in their charge. A colleague's agency is « not found », like a missing id
 * (own-agencies.test.ts reads every route and screen for this call).
 */
export async function loadOwnAgency(admin: Admin, id: string, who: { scopes: AdminScopes; userId: string }): Promise<AgencyRow | null> {
  const a = await loadAgency(admin, id);
  return a && mayWorkAgency(who.scopes, who.userId, a) ? a : null;
}

export async function addAgencyEvent(
  admin: Admin,
  agencyId: string,
  actorId: string | null,
  kind: AgencyEventKind,
  opts: { channel?: Channel | null; note?: string | null } = {},
): Promise<void> {
  const { error } = await admin.from("prospect_agency_events").insert({
    agency_id: agencyId,
    kind,
    channel: opts.channel ?? null,
    note: opts.note ? opts.note.slice(0, 2000) : null,
    actor_id: actorId,
  });
  if (error) aLog.error(`event ${kind} on ${agencyId} failed: ${error.message}`);
}

/** A call or a message was made: the agency is « contacted » from then on (unless it is further on). */
export async function recordContact(admin: Admin, agency: AgencyRow, actorId: string, channel: Channel): Promise<void> {
  await admin
    .from("prospect_agencies")
    .update({
      status: agency.status === "to_call" ? "contacted" : agency.status,
      last_contact_at: new Date().toISOString(),
      contact_count: agency.contact_count + 1,
      assigned_to: agency.assigned_to ?? actorId,
    })
    .eq("id", agency.id);
  await addAgencyEvent(admin, agency.id, actorId, "contacted", { channel });
}

/** What came of a call. A refusal that asks not to be called again (or a wrong or dead number) joins the « ne pas contacter » list. */
export async function recordResult(
  admin: Admin,
  agency: AgencyRow,
  actorId: string,
  input: { kind: AgencyResult; reason?: DeclineReason | null; followUpAt?: string | null; note?: string | null; doNotContact?: boolean },
): Promise<void> {
  const patch = patchForResult({ kind: input.kind, reason: input.reason, followUpAt: input.followUpAt });
  await admin
    .from("prospect_agencies")
    .update({
      ...patch,
      last_contact_at: new Date().toISOString(),
      assigned_to: agency.assigned_to ?? actorId,
    })
    .eq("id", agency.id);
  await addAgencyEvent(admin, agency.id, actorId, input.kind, { note: input.kind === "declined" ? declineNote(input.reason, input.note) : (input.note ?? null) });
  if (input.kind === "declined") {
    const dead = input.reason === "wrong_number" || input.reason === "closed_down";
    if (input.doNotContact || dead) {
      for (const phone of [agency.phone, agency.phone2]) {
        if (phone) await admin.from("prospect_dnc").upsert({ phone, reason: `agency: ${input.reason ?? "declined"}`, added_by: actorId }, { onConflict: "phone" });
      }
    }
  }
}

export async function reopenAgency(admin: Admin, agency: AgencyRow, actorId: string): Promise<boolean> {
  // A number on the « ne pas contacter » list stays there: reopening is for a call closed by mistake.
  const phones = [agency.phone, agency.phone2].filter((p): p is string => !!p);
  if (phones.length > 0) {
    const { data } = await admin.from("prospect_dnc").select("phone").in("phone", phones).limit(1);
    if ((data ?? []).length > 0) return false;
  }
  await admin.from("prospect_agencies").update({ status: "to_call", outcome: null, decline_reason: null, follow_up_at: null }).eq("id", agency.id);
  await addAgencyEvent(admin, agency.id, actorId, "reopened");
  return true;
}

export async function assignAgency(admin: Admin, agencyId: string, memberId: string | null, actorId: string): Promise<void> {
  await admin.from("prospect_agencies").update({ assigned_to: memberId }).eq("id", agencyId);
  await addAgencyEvent(admin, agencyId, actorId, "assigned", { note: memberId });
}

// ── The list: import and sharing out ────────────────────────────────────────

/** What the list already holds that an import must not repeat. */
async function existingFor(admin: Admin, rows: readonly ParsedAgency[]) {
  const phones = [...new Set(rows.flatMap((r) => [r.phone, r.phone2]).filter((p): p is string => !!p))];
  const have = new Set<string>();
  const dnc = new Set<string>();
  for (const part of chunks(phones, 200)) {
    const [a, b, d] = await Promise.all([
      admin.from("prospect_agencies").select("phone").in("phone", part),
      admin.from("prospect_agencies").select("phone2").in("phone2", part),
      admin.from("prospect_dnc").select("phone").in("phone", part),
    ]);
    for (const r of a.data ?? []) if (r.phone) have.add(r.phone as string);
    for (const r of b.data ?? []) if (r.phone2) have.add(r.phone2 as string);
    for (const r of d.data ?? []) dnc.add(r.phone as string);
  }
  const nameKeys = new Set<string>();
  if (rows.some((r) => !r.phone)) {
    const { data } = await admin.from("prospect_agencies").select("name, governorate").is("phone", null).limit(20000);
    for (const r of data ?? []) nameKeys.add(nameKey(r.name as string, (r.governorate as string | null) ?? null));
  }
  return { phones: have, nameKeys, dnc };
}

export type ImportResult = { plan: ImportPlan; inserted: number };

/**
 * Reads what a file would add (`dryRun`) or adds it. A number is on the list
 * once and never again; a number on the « ne pas contacter » list is never
 * added. Rows go in by hundreds; a row refused by the unique index (another
 * import at the same moment) is skipped, not fatal.
 */
export async function importAgencies(
  admin: Admin,
  input: { rows: readonly ParsedAgency[]; source: AgencySource; sourceNote: string | null; actorId: string; assignTo: string | null; dryRun: boolean },
): Promise<ImportResult> {
  const plan = planImport(input.rows, await existingFor(admin, input.rows));
  if (input.dryRun || plan.insert.length === 0) return { plan, inserted: 0 };

  let inserted = 0;
  for (const part of chunks(plan.insert, 200)) {
    const records = part.map((r) => ({
      name: r.name,
      phone: r.phone,
      phone2: r.phone2,
      governorate: r.governorate,
      city: r.city,
      address: r.address,
      website: r.website,
      facebook_url: r.facebook_url,
      email: r.email,
      legal_id: r.legal_id,
      licensed: r.licensed,
      source: input.source,
      source_note: input.sourceNote ?? r.note,
      assigned_to: input.assignTo,
      created_by: input.actorId,
    }));
    let ids: string[] = [];
    const { data, error } = await admin.from("prospect_agencies").insert(records).select("id");
    if (!error) {
      ids = (data ?? []).map((r) => r.id as string);
    } else {
      // A duplicate slipped in between the check and the insert: one by one, skipping it.
      for (const rec of records) {
        const one = await admin.from("prospect_agencies").insert(rec).select("id").maybeSingle();
        if (one.data) ids.push(one.data.id as string);
        else if (one.error && one.error.code !== "23505") aLog.error(`import row "${rec.name}" failed: ${one.error.message}`);
      }
    }
    inserted += ids.length;
    if (ids.length > 0) {
      await admin.from("prospect_agency_events").insert(ids.map((id) => ({ agency_id: id, kind: "imported", actor_id: input.actorId, note: input.sourceNote })));
    }
  }
  // An agency that already has an agence on the site was a member before anyone called it: it is marked, but it is not a day's « signed up ».
  await syncAgencyShops(admin, { quiet: true }).catch((e) => aLog.error(`match after import failed: ${(e as Error).message}`));
  return { plan, inserted };
}

/**
 * The unassigned agencies, shared out among `memberIds` in equal parts and by
 * governorate (shareOut in model.ts). Returns how many each member received.
 */
export async function shareOutUnassigned(admin: Admin, memberIds: readonly string[], actorId: string): Promise<Record<string, number>> {
  const { data } = await admin
    .from("prospect_agencies")
    .select("id, governorate")
    .is("assigned_to", null)
    .neq("status", "declined")
    .limit(20000);
  const plan = shareOut((data ?? []) as { id: string; governorate: string | null }[], memberIds);
  const counts: Record<string, number> = {};
  const byMember = new Map<string, string[]>();
  for (const [id, member] of plan) {
    if (!byMember.has(member)) byMember.set(member, []);
    byMember.get(member)!.push(id);
  }
  for (const [member, ids] of byMember) {
    for (const part of chunks(ids, 200)) {
      await admin.from("prospect_agencies").update({ assigned_to: member }).in("id", part).is("assigned_to", null);
      await admin.from("prospect_agency_events").insert(part.map((id) => ({ agency_id: id, kind: "assigned", actor_id: actorId, note: member })));
    }
    counts[member] = ids.length;
  }
  return counts;
}

// ── Found by the site: who signed up, who posted ────────────────────────────

/**
 * Matches the list with the agences of the site and writes what it finds, so
 * « who signed up, who posted » is never typed by hand. An agency is its agence
 * when a number of the list is the agence's number, or the number of the
 * account that owns it, or when the national register identifier is the same.
 * The first time an agency is seen with an agence, it gets a `signed_up` event;
 * the first time that agence has an annonce online, a `posted` one (no actor:
 * they count for the member in charge). Pending and approved agences count: the
 * request is the signing up. Idempotent, and cheap (a few hundred rows).
 * `quiet` marks what it finds without writing the events: for what was already
 * there when the list was imported, which the team did not bring.
 */
export async function syncAgencyShops(admin: Admin, opts: { quiet?: boolean } = {}): Promise<{ matched: number; posted: number }> {
  const [{ data: ag }, { data: shopsRaw }] = await Promise.all([
    admin.from("prospect_agencies").select("id, phone, phone2, legal_id, shop_id, first_posted_at").or("shop_id.is.null,first_posted_at.is.null").limit(20000),
    admin.from("shops").select("id, phone, legal_id, owner_id, status").in("status", ["pending", "approved"]).limit(20000),
  ]);
  const agencies = (ag ?? []) as { id: string; phone: string | null; phone2: string | null; legal_id: string | null; shop_id: string | null; first_posted_at: string | null }[];
  const shops = (shopsRaw ?? []) as { id: string; phone: string | null; legal_id: string | null; owner_id: string; status: string }[];
  if (agencies.length === 0 || shops.length === 0) return { matched: 0, posted: 0 };

  // The number of the account that owns each agence.
  const ownerIds = [...new Set(shops.map((s) => s.owner_id))];
  const ownerPhone = new Map<string, string>();
  for (const part of chunks(ownerIds, 200)) {
    const { data } = await admin.from("profiles").select("id, phone").in("id", part);
    for (const p of data ?? []) {
      const n = normalizePhone(p.phone as string | null);
      if (n) ownerPhone.set(p.id as string, n);
    }
  }
  const found = matchAgencyShops(agencies, shops, ownerPhone);
  const now = new Date().toISOString();
  let matched = 0;
  const shopOf = new Map<string, string>();
  for (const a of agencies) {
    if (a.shop_id) { shopOf.set(a.id, a.shop_id); continue; }
    const shopId = found.get(a.id);
    if (!shopId) continue;
    const { error } = await admin.from("prospect_agencies").update({ shop_id: shopId, signed_up_at: now }).eq("id", a.id).is("shop_id", null);
    if (!error) {
      matched++;
      if (!opts.quiet) await addAgencyEvent(admin, a.id, null, "signed_up");
      shopOf.set(a.id, shopId);
    }
  }

  // Which of those agences has an annonce online.
  let posted = 0;
  const shopIds = [...new Set(shopOf.values())];
  const online = new Set<string>();
  for (const part of chunks(shopIds, 200)) {
    const { data } = await admin.from("listings").select("shop_id").in("shop_id", part).eq("status", "published").limit(20000);
    for (const r of data ?? []) if (r.shop_id) online.add(r.shop_id as string);
  }
  for (const a of agencies) {
    const shopId = shopOf.get(a.id);
    if (!shopId || a.first_posted_at || !online.has(shopId)) continue;
    const { error } = await admin.from("prospect_agencies").update({ first_posted_at: now }).eq("id", a.id).is("first_posted_at", null);
    if (!error) {
      posted++;
      if (!opts.quiet) await addAgencyEvent(admin, a.id, null, "posted");
    }
  }
  return { matched, posted };
}

// ── The list on screen ──────────────────────────────────────────────────────

export type AgencyFilter = {
  /** Only the agencies of this member (a member's own, always). */
  assignedTo?: string | null;
  /** Only the unassigned ones. */
  unassigned?: boolean;
  stage?: AgencyStage | null;
  governorate?: string | null;
  q?: string | null;
  /** Only those whose follow-up date has come. */
  due?: boolean;
  page?: number;
};

export const AGENCY_PAGE_SIZE = 50;

/** One page of the list: follow-ups that are due first, then those still to call, oldest first. */
export async function listAgencies(admin: Admin, f: AgencyFilter): Promise<{ rows: AgencyRow[]; total: number }> {
  let q = admin.from("prospect_agencies").select(AGENCY_COLUMNS, { count: "exact" });
  if (f.assignedTo) q = q.eq("assigned_to", f.assignedTo);
  if (f.unassigned) q = q.is("assigned_to", null);
  if (f.governorate) q = q.eq("governorate", f.governorate);
  if (f.due) q = q.lte("follow_up_at", new Date().toISOString());
  switch (f.stage) {
    case "posted": q = q.not("first_posted_at", "is", null); break;
    case "signed_up": q = q.not("shop_id", "is", null).is("first_posted_at", null); break;
    case "to_call": case "contacted": case "interested": case "declined": q = q.is("shop_id", null).eq("status", f.stage); break;
    default: break;
  }
  const text = (f.q ?? "").replace(/[,()%*\\]/g, " ").trim().slice(0, 60);
  if (text) {
    const digits = text.replace(/\D/g, "");
    q = digits.length >= 4 ? q.or(`name.ilike.%${text}%,phone.ilike.%${digits}%,phone2.ilike.%${digits}%`) : q.ilike("name", `%${text}%`);
  }
  const page = Math.max(0, f.page ?? 0);
  const { data, count } = await q
    .order("follow_up_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .range(page * AGENCY_PAGE_SIZE, page * AGENCY_PAGE_SIZE + AGENCY_PAGE_SIZE - 1);
  return { rows: (data ?? []) as AgencyRow[], total: count ?? 0 };
}

export type Funnel = Record<AgencyStage, number> & { total: number; due: number };

/** The list by stage (and the follow-ups that are due), for one member or for everyone. */
export async function agencyFunnel(admin: Admin, assignedTo?: string | null): Promise<Funnel> {
  let q = admin.from("prospect_agencies").select("status, shop_id, first_posted_at, follow_up_at").limit(20000);
  if (assignedTo) q = q.eq("assigned_to", assignedTo);
  const { data } = await q;
  const out: Funnel = { to_call: 0, contacted: 0, interested: 0, declined: 0, signed_up: 0, posted: 0, total: 0, due: 0 };
  const now = Date.now();
  for (const r of (data ?? []) as { status: AgencyStatus; shop_id: string | null; first_posted_at: string | null; follow_up_at: string | null }[]) {
    out[stageOf(r)]++;
    out.total++;
    if (r.follow_up_at && Date.parse(r.follow_up_at) <= now && r.status !== "declined") out.due++;
  }
  return out;
}

/** Why the agencies that said no said it: the reasons, counted, newest answers included. */
export async function declineReasons(admin: Admin, assignedTo?: string | null): Promise<Record<string, number>> {
  let q = admin.from("prospect_agencies").select("decline_reason").eq("status", "declined").limit(20000);
  if (assignedTo) q = q.eq("assigned_to", assignedTo);
  const { data } = await q;
  const out: Record<string, number> = {};
  for (const r of data ?? []) {
    const k = (r.decline_reason as string | null) ?? "other";
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

// ── One day, for the report ─────────────────────────────────────────────────

export type AgencyDayEvent = {
  id: string;
  agencyId: string;
  name: string;
  kind: string;
  channel: string | null;
  note: string | null;
  /** Who did it; for what the site found, the member in charge. */
  actorId: string | null;
  assignedTo: string | null;
  at: string;
};

/** What the team did on the list during one day in Tunisia (midnight to midnight, or to `until`). */
export async function agencyDayReport(admin: Admin, day: string, until?: Date): Promise<{ figures: AgencyFigures[]; events: AgencyDayEvent[] }> {
  const { start, end } = dayBounds(day);
  const to = until && until.toISOString() < end ? until.toISOString() : end;
  const { data: raw } = await admin
    .from("prospect_agency_events")
    .select("id, agency_id, kind, channel, note, actor_id, created_at")
    .gte("created_at", start)
    .lt("created_at", to)
    .not("kind", "in", "(created,imported,assigned)")
    .order("created_at", { ascending: true })
    .limit(10000);
  const rows = (raw ?? []) as { id: string; agency_id: string; kind: string; channel: string | null; note: string | null; actor_id: string | null; created_at: string }[];

  const info = new Map<string, { name: string; assignedTo: string | null }>();
  for (const part of chunks([...new Set(rows.map((r) => r.agency_id))], 200)) {
    const { data } = await admin.from("prospect_agencies").select("id, name, assigned_to").in("id", part);
    for (const a of data ?? []) info.set(a.id as string, { name: a.name as string, assignedTo: (a.assigned_to as string | null) ?? null });
  }
  const events: AgencyDayEvent[] = rows.map((r) => ({
    id: r.id, agencyId: r.agency_id, name: info.get(r.agency_id)?.name ?? "—", kind: r.kind, channel: r.channel, note: r.note,
    actorId: r.actor_id, assignedTo: info.get(r.agency_id)?.assignedTo ?? null, at: r.created_at,
  }));
  return { figures: countAgencyFigures(events), events };
}

// ── The words sent to an agency ─────────────────────────────────────────────

/** The message for an agency (Réglages → Prospection holds the words): its name and the agencies' page. */
export async function agencyMessage(agency: Pick<AgencyRow, "name">, origin: string, language: "ar" | "fr"): Promise<string> {
  const s = await getSettings();
  return fillTemplate(language === "fr" ? s.prospect_ask_agency_fr : s.prospect_ask_agency_ar, {
    name: agency.name,
    link: `${origin}/${language}/pro`,
  });
}

/** Calls made today by a member (calls are not capped: only shown). */
export async function contactsTodayAgencies(admin: Admin, actorId: string): Promise<number> {
  const { count } = await admin
    .from("prospect_agency_events")
    .select("id", { count: "exact", head: true })
    .eq("actor_id", actorId)
    .eq("kind", "contacted")
    .gte("created_at", startOfTunisiaDay());
  return count ?? 0;
}

export type MemberStock = Funnel & { assignedTo: string | null };

/** The list by stage for each member (and the unassigned ones under `null`): what each holds and where it stands. */
export async function agencyStockByMember(admin: Admin): Promise<MemberStock[]> {
  const { data } = await admin.from("prospect_agencies").select("status, shop_id, first_posted_at, follow_up_at, assigned_to").limit(20000);
  const by = new Map<string | null, MemberStock>();
  const now = Date.now();
  for (const r of (data ?? []) as { status: AgencyStatus; shop_id: string | null; first_posted_at: string | null; follow_up_at: string | null; assigned_to: string | null }[]) {
    let s = by.get(r.assigned_to);
    if (!s) {
      s = { assignedTo: r.assigned_to, to_call: 0, contacted: 0, interested: 0, declined: 0, signed_up: 0, posted: 0, total: 0, due: 0 };
      by.set(r.assigned_to, s);
    }
    s[stageOf(r)]++;
    s.total++;
    if (r.follow_up_at && Date.parse(r.follow_up_at) <= now && r.status !== "declined") s.due++;
  }
  return [...by.values()].sort((a, b) => b.total - a.total);
}
