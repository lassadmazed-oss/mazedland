import type { getServiceSupabase } from "@/lib/supabase/admin";
import { canOpen, scopesFromRow } from "@/lib/admin/sections";
import { log } from "@/lib/log";
import { getSettings } from "@/lib/settings/server";
import { digestIsEmpty, digestText, digestsOf, retentionCutoff, startOfTunisiaDay, type WaitingRow } from "./model";

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

const pLog = log.scope("prospection-daily");

export const FOLLOWUP_KIND = "admin_prospect_followup";

/**
 * The daily run (07:05 UTC, 0219): one notice in the bell of each member who
 * has something waiting — never two on the same day — and the clean-up of old
 * leads. Never throws.
 */
export async function runDaily(admin: Admin, now: Date = new Date()): Promise<{ notified: number; purged: number; skipped?: string }> {
  const settings = await getSettings();
  if (!settings.feature_prospection) return { notified: 0, purged: 0, skipped: "feature_off" };

  let notified = 0;
  if (settings.prospect_reminders) {
    const { data } = await admin
      .from("prospect_leads")
      .select("id, status, assigned_to, created_by, confirmed_by, follow_up_at, confirmed_at, sms_sent_at, published_at")
      .in("status", ["to_contact", "contacted", "confirmed", "online"])
      .limit(5000);
    const digests = digestsOf((data ?? []) as WaitingRow[], now);

    if (digests.size > 0) {
      const { data: members } = await admin
        .from("profiles")
        .select("id, role, admin_scopes, banned_at")
        .in("id", [...digests.keys()]);
      const since = startOfTunisiaDay(now);
      for (const m of members ?? []) {
        if (m.role !== "admin" || m.banned_at || !canOpen(scopesFromRow(m.admin_scopes), "prospection")) continue;
        const digest = digests.get(m.id as string)!;
        if (digestIsEmpty(digest)) continue;
        const { count } = await admin
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", m.id)
          .eq("kind", FOLLOWUP_KIND)
          .gte("created_at", since);
        if ((count ?? 0) > 0) continue;
        const { error } = await admin.rpc("enqueue_notification", {
          p_user_id: m.id,
          p_kind: FOLLOWUP_KIND,
          p_title: "Prospection : à traiter aujourd'hui",
          p_body: digestText(digest),
          p_link: "/admin/prospection",
          p_payload: { vars: { followUps: digest.followUps, yes: digest.yes, noSms: digest.noSms } },
        });
        if (error) pLog.error(`reminder for ${m.id} failed: ${error.message}`);
        else notified++;
      }
    }
  }

  // Privacy: what a post said about a stranger is not kept for ever. Leads that
  // ended (declined, or online and handed over) lose the post's text and the
  // poster's name after `prospect_keep_days`; the owner's reply that stood for
  // their yes stays, it is the proof. The « ne pas contacter » list keeps its
  // numbers: that is its job.
  let purged = 0;
  const cutoff = retentionCutoff(settings.prospect_keep_days, now);
  // The leads are read first and written by id: an update touches `updated_at`,
  // so a second pass by date would no longer find what the first one cleared.
  const { data: stale } = await admin
    .from("prospect_leads")
    .select("id, status, source_text, phone")
    .in("status", ["declined", "online"])
    .lt("updated_at", cutoff)
    .limit(2000);
  const rows = (stale ?? []) as { id: string; status: string; source_text: string; phone: string | null }[];
  // A declined lead also loses its number (the « ne pas contacter » list keeps it).
  const declined = rows.filter((r) => r.status === "declined" && (r.source_text !== "—" || r.phone !== null)).map((r) => r.id);
  const online = rows.filter((r) => r.status === "online" && r.source_text !== "—").map((r) => r.id);
  if (declined.length > 0) {
    const { error } = await admin.from("prospect_leads").update({ source_text: "—", poster_name: null, source_url: null, phone: null }).in("id", declined);
    if (!error) purged += declined.length;
  }
  if (online.length > 0) {
    const { error } = await admin.from("prospect_leads").update({ source_text: "—", poster_name: null, source_url: null }).in("id", online);
    if (!error) purged += online.length;
  }

  if (notified || purged) pLog.info(`${notified} reminder(s), ${purged} lead field(s) cleared`);
  return { notified, purged };
}
