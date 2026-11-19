import type { getServiceSupabase } from "@/lib/supabase/admin";
import { canOpen, scopesFromRow } from "@/lib/admin/sections";
import { log } from "@/lib/log";
import { getSettings } from "@/lib/settings/server";
import { agencyReportText } from "./agencies/model";
import { agencyDayReport } from "./agencies/server";
import {
  countFigures, dayBounds, dayLabel, propertyLine, readDraft, reportText, shownKind, startOfTunisiaDay, tunisiaDay, tunisiaHour,
  type ReportRow,
} from "./model";

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

const pLog = log.scope("prospection-report");

export const REPORT_KIND = "admin_prospect_report";

/** One thing a member did on the day: the page lists them under the member's name. */
export type DayEvent = {
  id: string;
  leadId: string;
  kind: string;
  channel: string | null;
  note: string | null;
  actorId: string;
  at: string;
  /** What the lead is about, for the link. */
  title: string;
};

export type DayReport = {
  day: string;
  /** Every member of the team, the idle ones too (that is what the owner wants to see), then anyone else who acted. */
  rows: (ReportRow & { actorId: string })[];
  events: DayEvent[];
};

/**
 * The team: console members given « Prospection » (not the whole console — the
 * owner is not the team), by name. They are listed even on a day they did
 * nothing: a silent day is the thing the report is for.
 */
export async function teamNames(admin: Admin): Promise<Map<string, string>> {
  const { data } = await admin.from("profiles").select("id, full_name, admin_scopes, banned_at").eq("role", "admin").limit(300);
  const out = new Map<string, string>();
  for (const p of data ?? []) {
    if (p.banned_at) continue;
    const scopes = scopesFromRow(p.admin_scopes);
    if (scopes !== null && canOpen(scopes, "prospection")) out.set(p.id as string, (p.full_name as string | null)?.trim() || "—");
  }
  return out;
}

/** What each member of the team did on one day in Tunisia (midnight to midnight, or to `until`). */
export async function dayReport(admin: Admin, day: string, until?: Date): Promise<DayReport> {
  const { start, end } = dayBounds(day);
  const to = until && until.toISOString() < end ? until.toISOString() : end;
  const [{ data: raw }, team] = await Promise.all([
    admin
      .from("prospect_events")
      .select("id, lead_id, kind, channel, note, actor_id, created_at")
      .gte("created_at", start)
      .lt("created_at", to)
      .not("actor_id", "is", null)
      .order("created_at", { ascending: true })
      .limit(5000),
    teamNames(admin),
  ]);
  const events = (raw ?? []) as { id: string; lead_id: string; kind: string; channel: string | null; note: string | null; actor_id: string; created_at: string }[];

  const figures = new Map(countFigures(events).map((f) => [f.actorId, f]));
  const ids = new Set<string>([...team.keys(), ...events.map((e) => e.actor_id)]);
  const names = new Map(team);
  const unknown = [...ids].filter((id) => !names.has(id));
  if (unknown.length > 0) {
    const { data } = await admin.from("profiles").select("id, full_name").in("id", unknown);
    for (const p of data ?? []) names.set(p.id as string, (p.full_name as string | null)?.trim() || "—");
  }

  const rows = [...ids].map((actorId) => {
    const f = figures.get(actorId);
    return { actorId, name: names.get(actorId) ?? "—", created: f?.created ?? 0, contacted: f?.contacted ?? 0, yes: f?.yes ?? 0, online: f?.online ?? 0, refused: f?.refused ?? 0, noAnswer: f?.noAnswer ?? 0 };
  });
  // Who worked most first, the idle at the end, each group by name.
  const worked = (r: (typeof rows)[number]) => r.created + r.contacted + r.yes + r.online + r.refused + r.noAnswer;
  rows.sort((a, b) => worked(b) - worked(a) || b.contacted - a.contacted || a.name.localeCompare(b.name));

  const titles = new Map<string, string>();
  const leadIds = [...new Set(events.map((e) => e.lead_id))];
  for (let i = 0; i < leadIds.length; i += 200) {
    const { data } = await admin.from("prospect_leads").select("id, draft, poster_name").in("id", leadIds.slice(i, i + 200));
    for (const l of data ?? []) titles.set(l.id as string, propertyLine(readDraft(l.draft)) || (l.poster_name as string | null) || "—");
  }

  return {
    day,
    rows,
    events: events.map((e) => ({ id: e.id, leadId: e.lead_id, kind: shownKind(e.kind, e.note), channel: e.channel, note: e.note, actorId: e.actor_id, at: e.created_at, title: titles.get(e.lead_id) ?? "—" })),
  };
}

/**
 * The agencies' part of the evening notice (0229): each member's day on the list
 * (calls · reached · interested · joined or posted), the idle ones too. Empty
 * while the list is empty, so a site that does not use it reads the notice it
 * always did.
 */
async function agencyEveningText(admin: Admin, day: string, now: Date): Promise<string> {
  const { count } = await admin.from("prospect_agencies").select("id", { count: "exact", head: true });
  if ((count ?? 0) === 0) return "";
  const [{ figures }, team] = await Promise.all([agencyDayReport(admin, day, now), teamNames(admin)]);
  const by = new Map(figures.map((f) => [f.actorId, f]));
  const ids = new Set<string>([...team.keys(), ...figures.map((f) => f.actorId)]);
  const names = new Map(team);
  const unknown = [...ids].filter((id) => !names.has(id));
  if (unknown.length > 0) {
    const { data } = await admin.from("profiles").select("id, full_name").in("id", unknown);
    for (const p of data ?? []) names.set(p.id as string, (p.full_name as string | null)?.trim() || "—");
  }
  const rows = [...ids].map((id) => {
    const f = by.get(id);
    return { name: names.get(id) ?? "—", contacted: f?.contacted ?? 0, reached: f?.reached ?? 0, interested: f?.interested ?? 0, signedUp: f?.signedUp ?? 0, posted: f?.posted ?? 0 };
  });
  rows.sort((a, b) => b.contacted - a.contacted || a.name.localeCompare(b.name));
  return agencyReportText(rows);
}

/**
 * The evening notice (0223): from the hour set in Réglages, one notice in the
 * bell of each admin who holds the whole console, with what every member of the
 * team did that day — and a link to the day's page. Never twice on the same day,
 * and a run that comes late still sends it. Never throws.
 */
export async function runReport(admin: Admin, now: Date = new Date()): Promise<{ notified: number; skipped?: string }> {
  const settings = await getSettings();
  if (!settings.feature_prospection) return { notified: 0, skipped: "feature_off" };
  if (!settings.prospect_report) return { notified: 0, skipped: "report_off" };
  if (tunisiaHour(now) < settings.prospect_report_hour) return { notified: 0, skipped: "too_early" };

  const day = tunisiaDay(now);
  const report = await dayReport(admin, day, now);
  if (report.rows.length === 0) return { notified: 0, skipped: "nobody" };
  const text = reportText(report.rows);
  const agencies = await agencyEveningText(admin, day, now).catch((e) => {
    pLog.error(`agencies part of the report failed: ${(e as Error).message}`);
    return "";
  });

  const { data: owners } = await admin.from("profiles").select("id, admin_scopes, banned_at").eq("role", "admin").limit(300);
  const since = startOfTunisiaDay(now);
  let notified = 0;
  for (const o of owners ?? []) {
    if (o.banned_at || scopesFromRow(o.admin_scopes) !== null) continue;
    const { count } = await admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", o.id)
      .eq("kind", REPORT_KIND)
      .gte("created_at", since);
    if ((count ?? 0) > 0) continue;
    const { error } = await admin.rpc("enqueue_notification", {
      p_user_id: o.id,
      p_kind: REPORT_KIND,
      p_title: "Prospection : le bilan du jour",
      p_body: `${dayLabel(day)} — premiers messages · oui · en ligne : ${text}${agencies ? ` ‖ agences (appels · jointes · intéressées · inscrites ou publiées) : ${agencies}` : ""}`,
      p_link: `/admin/prospection/rapport?day=${day}`,
      // « withAgencies »: the same notice with the list's part (messages: admin_prospect_report.withAgencies).
      p_payload: { vars: { day: dayLabel(day), lines: text, ...(agencies ? { agencies, variant: "withAgencies" } : {}) } },
    });
    if (error) pLog.error(`report for ${o.id} failed: ${error.message}`);
    else notified++;
  }
  if (notified) pLog.info(`${notified} evening report(s) for ${day}`);
  return { notified };
}
