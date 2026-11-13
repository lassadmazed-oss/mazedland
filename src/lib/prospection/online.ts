import { createHash, randomBytes } from "node:crypto";
import type { getServiceSupabase } from "@/lib/supabase/admin";
import { log } from "@/lib/log";
import { getSettings } from "@/lib/settings/server";
import { siteUrl } from "@/lib/siteUrl";
import { sendSms } from "@/lib/winsms";
import { fillTemplate, type Channel, type EventKind, type LeadStatus } from "./model";

/**
 * What happens to a lead once its annonce is online, kept apart from the rest
 * of Prospection (server.ts) so that publishing an annonce (src/lib/listings/
 * publish.ts) can call it without a loop of imports: it reads the lead of the
 * annonce, marks it online, and tells the owner by SMS with their private link.
 */
type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

const pLog = log.scope("prospection");

/** A prospect_leads row, as the screens read it. */
export type LeadRow = {
  id: string;
  status: LeadStatus;
  phone: string | null;
  poster_name: string | null;
  source_url: string | null;
  source_text: string;
  language: "ar" | "fr";
  draft: unknown;
  is_broker: boolean;
  assigned_to: string | null;
  created_by: string | null;
  follow_up_at: string | null;
  outcome: string | null;
  confirmation_text: string | null;
  confirmation_channel: Channel | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  seller_id: string | null;
  listing_id: string | null;
  published_at: string | null;
  sms_sent_at: string | null;
  sms_error: string | null;
  created_at: string;
  updated_at: string;
};

export const LEAD_COLUMNS =
  "id, status, phone, poster_name, source_url, source_text, language, draft, is_broker, assigned_to, created_by, follow_up_at, outcome, confirmation_text, confirmation_channel, confirmed_at, confirmed_by, seller_id, listing_id, published_at, sms_sent_at, sms_error, created_at, updated_at";

export async function loadLead(admin: Admin, id: string): Promise<LeadRow | null> {
  const { data } = await admin.from("prospect_leads").select(LEAD_COLUMNS).eq("id", id).maybeSingle();
  return (data as LeadRow | null) ?? null;
}

export async function addEvent(
  admin: Admin,
  leadId: string,
  actorId: string | null,
  kind: EventKind,
  opts: { channel?: Channel | null; note?: string | null } = {},
): Promise<void> {
  const { error } = await admin.from("prospect_events").insert({
    lead_id: leadId,
    kind,
    channel: opts.channel ?? null,
    note: opts.note ? opts.note.slice(0, 2000) : null,
    actor_id: actorId,
  });
  if (error) pLog.error(`event ${kind} on ${leadId} failed: ${error.message}`);
}

// ── The owner's private link ────────────────────────────────────────────────

export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

/** A new private link for the annonce; any earlier one stops working. */
export async function mintManageToken(admin: Admin, listingId: string, sellerId: string): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await admin.from("listing_manage_tokens").delete().eq("listing_id", listingId);
  await admin.from("listing_manage_tokens").insert({ token_hash: tokenHash(token), listing_id: listingId, seller_id: sellerId });
  return token;
}

const NON_GSM = /[^\x00-\x7F]/;

/**
 * The SMS an owner receives once their annonce is online: its link, their
 * private link, and the team's number (Réglages → Prospection holds the
 * words). Recorded on the lead, sent or not.
 */
export async function sendOwnerSms(
  admin: Admin,
  input: { lead: LeadRow; origin: string; actorId: string | null },
): Promise<{ sent: boolean; error?: string }> {
  const { lead } = input;
  if (!lead.phone || !lead.listing_id || !lead.seller_id) return { sent: false, error: "no_listing" };
  const settings = await getSettings();
  const token = await mintManageToken(admin, lead.listing_id, lead.seller_id);
  const text = fillTemplate(lead.language === "fr" ? settings.prospect_sms_fr : settings.prospect_sms_ar, {
    link: `${input.origin}/${lead.language}/annonces/${lead.listing_id}`,
    manage: `${input.origin}/${lead.language}/gerer/${token}`,
    phone: settings.prospect_team_phone || settings.contact_whatsapp,
  });
  const res = await sendSms({ to: lead.phone, sms: text, unicode: NON_GSM.test(text) });
  const now = new Date().toISOString();
  if (res.ok) {
    await admin.from("prospect_leads").update({ sms_sent_at: now, sms_error: null }).eq("id", lead.id);
    await addEvent(admin, lead.id, input.actorId, "sms", { channel: "sms" });
    return { sent: true };
  }
  const error = String(res.error ?? "failed").slice(0, 200);
  await admin.from("prospect_leads").update({ sms_error: error }).eq("id", lead.id);
  await addEvent(admin, lead.id, input.actorId, "sms", { channel: "sms", note: `failed: ${error}` });
  return { sent: false, error };
}

/**
 * A lead whose annonce is online (approved by an admin after the rules held
 * it, or published at once): the lead follows. Returns the lead as it stands.
 */
export async function syncLeadWithListing(admin: Admin, lead: LeadRow): Promise<LeadRow> {
  if (lead.status !== "confirmed" || !lead.listing_id) return lead;
  const { data } = await admin.from("listings").select("status, published_at").eq("id", lead.listing_id).maybeSingle();
  if (data?.status !== "published") return lead;
  const at = (data.published_at as string | null) ?? new Date().toISOString();
  const { data: moved } = await admin
    .from("prospect_leads")
    .update({ status: "online", published_at: at })
    .eq("id", lead.id)
    .eq("status", "confirmed")
    .select("id");
  // Only the one that moved it records it: two views at once do not write twice.
  if ((moved ?? []).length > 0) await addEvent(admin, lead.id, null, "published", { note: "online" });
  return { ...lead, status: "online", published_at: at };
}

/**
 * Called by publishListing the moment an annonce of the team goes online
 * (automatically, or approved by an admin): the lead is marked online and the
 * owner told by SMS, once. Never throws — the publication has happened.
 */
export async function onListingPublished(admin: Admin, listingId: string): Promise<void> {
  try {
    const { data } = await admin.from("prospect_leads").select(LEAD_COLUMNS).eq("listing_id", listingId).maybeSingle();
    const found = data as LeadRow | null;
    if (!found) return;
    const lead = await syncLeadWithListing(admin, found);
    if (lead.status !== "online" || lead.sms_sent_at) return;
    await sendOwnerSms(admin, { lead, origin: siteUrl() ?? "https://www.mazed.immo", actorId: null });
  } catch (e) {
    pLog.error(`online hook for ${listingId} failed`, { error: String((e as Error)?.message ?? e) });
  }
}
