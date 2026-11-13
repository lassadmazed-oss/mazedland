import { randomBytes } from "node:crypto";
import type { getServiceSupabase } from "@/lib/supabase/admin";
import { audit } from "@/lib/admin/audit";
import { callJson } from "@/lib/ai/server";
import {
  buildSystemPrompt, LISTING_DRAFT_SCHEMA, normalizeListingDraft, type DraftCategory, type ListingDraft,
} from "@/lib/ai/listing";
import { phoneEmail } from "@/lib/auth/phoneEmail";
import { recordConsents } from "@/lib/consents/server";
import { categoryLabel } from "@/lib/i18n";
import { attributeOutOfBounds, listingFields } from "@/lib/listings/input";
import { asDealType } from "@/lib/listings/deal";
import { missingPhotos } from "@/lib/listings/storage";
import { log } from "@/lib/log";
import { moderationSettings, publishOrQueue } from "@/lib/moderation/server";
import { redactContacts } from "@/lib/moderation/rules";
import { takePlace } from "@/lib/places/server";
import { getSettings } from "@/lib/settings/server";
import {
  confirmBlockers, draftToListingBody, fillTemplate, photoPathOf, propertyLine, publishBlockers, readDraft, startOfTunisiaDay, statusAfter,
  type Channel, type ConfirmBlocker, type PublishBlocker,
} from "./model";
import { addEvent, loadLead, syncLeadWithListing, tokenHash, type LeadRow } from "./online";

// What the screens and routes import from here; the lead's life once online lives in ./online.
export { addEvent, loadLead, LEAD_COLUMNS, mintManageToken, sendOwnerSms, syncLeadWithListing, type LeadRow } from "./online";

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

const pLog = log.scope("prospection");

// ── What was done ───────────────────────────────────────────────────────────

/** The contacts a member made today (the daily cap counts these). */
export async function contactsToday(admin: Admin, actorId: string): Promise<number> {
  const { count } = await admin
    .from("prospect_events")
    .select("id", { count: "exact", head: true })
    .eq("actor_id", actorId)
    .eq("kind", "contacted")
    .gte("created_at", startOfTunisiaDay());
  return count ?? 0;
}

// ── The « ne pas contacter » list ───────────────────────────────────────────

export async function isDoNotContact(admin: Admin, phone: string | null): Promise<boolean> {
  if (!phone) return false;
  const { data } = await admin.from("prospect_dnc").select("phone").eq("phone", phone).maybeSingle();
  return Boolean(data);
}

export async function addDoNotContact(admin: Admin, phone: string, actorId: string, reason: string): Promise<void> {
  await admin.from("prospect_dnc").upsert({ phone, reason: reason.slice(0, 300), added_by: actorId }, { onConflict: "phone" });
}

// ── Before a lead is made ───────────────────────────────────────────────────

export type Warnings = {
  doNotContact: boolean;
  /** The number already has an account on Mazed Immo: the owner is a member. */
  member: { id: string; name: string | null } | null;
  /** Other leads on the same number or the same post. */
  others: { id: string; status: string }[];
};

export async function leadWarnings(
  admin: Admin,
  input: { phone: string | null; sourceUrl: string | null; excludeId?: string },
): Promise<Warnings> {
  const [dnc, member, byPhone, byUrl] = await Promise.all([
    isDoNotContact(admin, input.phone),
    input.phone
      ? admin.from("profiles").select("id, full_name").eq("phone", input.phone).maybeSingle()
      : Promise.resolve({ data: null }),
    input.phone ? admin.from("prospect_leads").select("id, status").eq("phone", input.phone).limit(6) : Promise.resolve({ data: [] }),
    input.sourceUrl ? admin.from("prospect_leads").select("id, status").eq("source_url", input.sourceUrl).limit(6) : Promise.resolve({ data: [] }),
  ]);
  const seen = new Set<string>();
  const others: { id: string; status: string }[] = [];
  for (const r of [...(byPhone.data ?? []), ...(byUrl.data ?? [])] as { id: string; status: string }[]) {
    if (r.id === input.excludeId || seen.has(r.id)) continue;
    seen.add(r.id);
    others.push(r);
  }
  const m = member.data as { id: string; full_name: string | null } | null;
  return { doNotContact: dnc, member: m ? { id: m.id, name: m.full_name } : null, others };
}

// ── Reading the post ────────────────────────────────────────────────────────

async function draftCategories(admin: Admin): Promise<DraftCategory[]> {
  const { data } = await admin
    .from("categories")
    .select("slug, label_fr, label_ar, kind, parent_id")
    .eq("is_active", true);
  return (data ?? [])
    .filter((c) => c.parent_id != null)
    .map((c) => ({
      slug: c.slug as string,
      label: categoryLabel(c as { label_fr: string; label_ar: string | null }, "fr"),
      kind: c.kind as string,
    }));
}

/**
 * The post, read into a draft by the same assistant as « Décrivez votre bien
 * en une phrase » (src/lib/ai/listing.ts): only what the post says, the rest
 * left empty and turned into questions. Numbers and links are removed before
 * the text leaves the site. When the assistant is off or out of budget, the
 * team fills the draft by hand: nothing else depends on it.
 */
export async function readPost(
  admin: Admin,
  actorId: string,
  text: string,
): Promise<{ ok: true; draft: ListingDraft; language: "ar" | "fr" } | { ok: false; reason: "unavailable" | "refused" | "failed" }> {
  const source = text.trim().slice(0, 4000);
  const categories = await draftCategories(admin);
  const out = await callJson({
    admin,
    userId: actorId,
    feature: "prospect_draft",
    system: buildSystemPrompt(categories),
    user: redactContacts(source),
    schema: LISTING_DRAFT_SCHEMA as unknown as Record<string, unknown>,
  });
  if (!out.ok) return { ok: false, reason: out.reason };
  const language = (out.data as { language?: unknown } | null)?.language === "fr" ? "fr" : "ar";
  return { ok: true, draft: normalizeListingDraft(out.data, { categories, sourceText: source }), language };
}

// ── The owner's yes ─────────────────────────────────────────────────────────

async function categoryId(admin: Admin, slug: string): Promise<string | null> {
  const { data } = await admin
    .from("categories")
    .select("id, parent_id, is_active")
    .eq("slug", slug)
    .maybeSingle();
  return data && data.is_active && data.parent_id != null ? (data.id as string) : null;
}

/**
 * The account of an owner who said yes: found by their number, or made with a
 * password nobody knows — the owner sets their own through « mot de passe
 * oublié » (a code by SMS), the way any member does. A suspended account is
 * never used.
 */
async function ensureSeller(
  admin: Admin,
  input: { phone: string; name: string | null; language: "ar" | "fr" },
): Promise<{ ok: true; id: string; created: boolean } | { ok: false; error: "seller_suspended" | "account_failed" }> {
  const find = async () => {
    const { data } = await admin.from("profiles").select("id, banned_at").eq("phone", input.phone).maybeSingle();
    return data as { id: string; banned_at: string | null } | null;
  };
  const existing = await find();
  if (existing) return existing.banned_at ? { ok: false, error: "seller_suspended" } : { ok: true, id: existing.id, created: false };

  const { data: made, error } = await admin.auth.admin.createUser({
    email: phoneEmail(input.phone),
    password: randomBytes(24).toString("base64url"),
    email_confirm: true,
    user_metadata: { full_name: input.name, phone: input.phone, language: input.language },
  });
  if (error || !made.user) {
    // A race with another lead of the same owner, or a profile made meanwhile.
    const again = await find();
    if (again && !again.banned_at) return { ok: true, id: again.id, created: false };
    pLog.error(`account for ${input.phone} failed: ${error?.message ?? "no user"}`);
    return { ok: false, error: "account_failed" };
  }
  return { ok: true, id: made.user.id, created: true };
}

export type ConfirmResult =
  | { ok: true; listingId: string; sellerId: string; createdAccount: boolean }
  | { ok: false; error: "not_found" | "blocked" | "bad_category" | "seller_suspended" | "account_failed" | "listing_failed"; blockers?: ConfirmBlocker[] };

/**
 * « Il a dit oui »: the account on the owner's number, their consent to the
 * terms (kept with the words they answered), and a draft annonce in it from
 * the lead's draft. Nothing goes online here: the photos come next.
 */
export async function confirmLead(
  admin: Admin,
  input: { leadId: string; actorId: string; reply: string; channel: Channel | null },
): Promise<ConfirmResult> {
  const lead = await loadLead(admin, input.leadId);
  if (!lead) return { ok: false, error: "not_found" };
  const draft = readDraft(lead.draft);
  const blockers = confirmBlockers({
    status: lead.status,
    phone: lead.phone,
    doNotContact: await isDoNotContact(admin, lead.phone),
    draft,
    reply: input.reply,
    channel: input.channel,
  });
  if (blockers.length > 0) return { ok: false, error: "blocked", blockers };

  const cat = await categoryId(admin, draft.categorySlug!);
  if (!cat) return { ok: false, error: "bad_category" };

  const seller = await ensureSeller(admin, { phone: lead.phone!, name: lead.poster_name, language: lead.language });
  if (!seller.ok) return seller;

  // The owner answered a message that asked for exactly this: the terms and the
  // privacy policy (accepted together), kept with the version they were shown.
  const { legal_version } = await getSettings();
  await recordConsents(
    admin,
    seller.id,
    [{ kind: "terms", granted: true }, { kind: "privacy", granted: true }],
    legal_version,
    "team",
  );

  const now = new Date().toISOString();
  const fields = listingFields(draftToListingBody(draft, { categoryId: cat, contactName: lead.poster_name, contactPhone: lead.phone! }));
  const { data: created, error } = await admin
    .from("listings")
    .insert({ ...fields, seller_id: seller.id, status: "draft", team_confirmed_at: now })
    .select("id")
    .single();
  if (error || !created) {
    pLog.error(`draft for lead ${lead.id} failed: ${error?.message ?? "no row"}`);
    return { ok: false, error: "listing_failed" };
  }

  await admin
    .from("prospect_leads")
    .update({
      status: statusAfter(lead.status, "confirmed"),
      seller_id: seller.id,
      listing_id: created.id,
      confirmation_text: input.reply.trim().slice(0, 2000),
      confirmation_channel: input.channel,
      confirmed_at: now,
      confirmed_by: input.actorId,
      outcome: null,
      follow_up_at: null,
    })
    .eq("id", lead.id);
  await addEvent(admin, lead.id, input.actorId, "confirmed", { channel: input.channel, note: input.reply });
  await audit(admin, input.actorId, {
    action: "prospect.confirm",
    targetType: "listing",
    targetId: created.id as string,
    note: `lead ${lead.id} · ${lead.phone} · ${input.channel}`,
  });
  return { ok: true, listingId: created.id as string, sellerId: seller.id, createdAccount: seller.created };
}

/**
 * The lead's draft written to its annonce again, while that annonce is still a
 * draft: the team corrects a price or a title after the yes and the annonce
 * follows. Only the columns the form would set.
 */
export async function syncDraftToListing(admin: Admin, lead: LeadRow): Promise<boolean> {
  if (!lead.listing_id || !lead.phone) return false;
  const draft = readDraft(lead.draft);
  if (!draft.categorySlug) return false;
  const cat = await categoryId(admin, draft.categorySlug);
  if (!cat) return false;
  const fields = listingFields(draftToListingBody(draft, { categoryId: cat, contactName: lead.poster_name, contactPhone: lead.phone }));
  const { error } = await admin
    .from("listings")
    .update(fields)
    .eq("id", lead.listing_id)
    .in("status", ["draft", "rejected"]);
  return !error;
}

// ── Photos ──────────────────────────────────────────────────────────────────

const SAFE_EXT = /^[a-z0-9]{1,5}$/;

/** Signed upload URLs into the owner's own folder, the way the publish form gets them. */
export async function mintPhotoUrls(admin: Admin, sellerId: string, exts: string[]): Promise<{ path: string; signedUrl: string }[] | null> {
  const stamp = Date.now();
  const minted = await Promise.all(
    exts.map(async (raw, i) => {
      const ext = SAFE_EXT.test(raw.toLowerCase()) ? raw.toLowerCase() : "webp";
      const path = `${sellerId}/annonce-${stamp}-${Math.round(Math.random() * 1e6)}-${i}.${ext}`;
      const { data, error } = await admin.storage.from("properties").createSignedUploadUrl(path);
      return error || !data?.signedUrl ? null : { path, signedUrl: data.signedUrl };
    }),
  );
  return minted.every((m) => m !== null) ? (minted as { path: string; signedUrl: string }[]) : null;
}

/** The gallery as it should end up, in order: replaces the rows of the annonce. */
export async function savePhotos(admin: Admin, lead: LeadRow, paths: unknown, max: number): Promise<{ ok: true; paths: string[] } | { ok: false; error: "not_confirmed" | "save_failed" }> {
  if (!lead.listing_id || !lead.seller_id) return { ok: false, error: "not_confirmed" };
  const clean = (Array.isArray(paths) ? paths : [])
    .map((p) => photoPathOf(lead.seller_id!, p))
    .filter((p): p is string => !!p)
    .slice(0, max);
  await admin.from("listing_photos").delete().eq("listing_id", lead.listing_id);
  if (clean.length > 0) {
    const { error } = await admin
      .from("listing_photos")
      .insert(clean.map((storage_path, sort_order) => ({ listing_id: lead.listing_id, storage_path, sort_order })));
    if (error) return { ok: false, error: "save_failed" };
  }
  return { ok: true, paths: clean };
}

// ── Going online ────────────────────────────────────────────────────────────

export type PublishResult =
  | { ok: true; outcome: "published" | "pending_review"; sms: { sent: boolean; error?: string } | null }
  | {
      ok: false;
      error: "not_found" | "blocked" | "listing_missing" | "photo_missing" | "attribute_required" | "not_submittable" | "taken_down" | "free_limit_reached" | "failed";
      blockers?: PublishBlocker[];
      fields?: string[];
    };

/**
 * The annonce of a lead that said yes goes through the same door as any other
 * (a free place, then the moderation rules) — with one difference: a member of
 * the team vouched for it, so it is not read as a stranger's first annonce.
 * Everything else still applies: banned words, a contact in the text, a price
 * out of range, too few photos.
 */
export async function publishLead(
  admin: Admin,
  input: { leadId: string; actorId: string; photosChecked: boolean; origin: string },
): Promise<PublishResult> {
  const lead = await loadLead(admin, input.leadId);
  if (!lead) return { ok: false, error: "not_found" };
  if (!lead.listing_id || !lead.seller_id) return { ok: false, error: "listing_missing" };

  const settings = await moderationSettings(admin);
  const draft = readDraft(lead.draft);
  const { count: photoCount } = await admin
    .from("listing_photos")
    .select("id", { count: "exact", head: true })
    .eq("listing_id", lead.listing_id);
  const blockers = publishBlockers({
    status: lead.status,
    hasListing: true,
    photoCount: photoCount ?? 0,
    minPhotos: settings.minPhotos,
    photosChecked: input.photosChecked,
    draft,
  });
  if (blockers.length > 0) return { ok: false, error: "blocked", blockers };
  if ((await missingPhotos(admin, lead.listing_id)).length > 0) return { ok: false, error: "photo_missing" };

  const { data: listing } = await admin
    .from("listings")
    .select("id, seller_id, category_id, status, attributes, deal_type, shop_id")
    .eq("id", lead.listing_id)
    .maybeSingle();
  if (!listing) return { ok: false, error: "listing_missing" };

  // Every question the category requires for this deal, answered with a
  // figure a property can have (the same check as the seller's submit).
  const { data: questions } = await admin
    .from("category_attributes")
    .select("field_key, deal_types")
    .eq("category_id", listing.category_id)
    .eq("required", true);
  const deal = asDealType(listing.deal_type as string | null);
  const attrs = (listing.attributes ?? {}) as Record<string, unknown>;
  const unanswered = ((questions ?? []) as { field_key: string; deal_types: string[] | null }[])
    .filter((q) => !q.deal_types || q.deal_types.length === 0 || q.deal_types.includes(deal))
    .filter((q) => {
      const v = attrs[q.field_key];
      return v == null || String(v).trim() === "" || attributeOutOfBounds(q.field_key, v);
    })
    .map((q) => q.field_key);
  if (unanswered.length > 0) return { ok: false, error: "attribute_required", fields: unanswered };

  const from = ["draft", "rejected", "pending_payment"];
  if (!from.includes(listing.status as string)) return { ok: false, error: "not_submittable" };
  const taken = await takePlace(
    admin,
    { userId: lead.seller_id, listingId: lead.listing_id, shopId: (listing.shop_id as string | null) ?? null, fromStatus: String(listing.status) },
    settings.freeLimit,
    { from, to: "pending_review" },
  );
  if (!taken.ok) {
    if (taken.reason === "taken_down") return { ok: false, error: "taken_down" };
    if (taken.reason === "not_submittable") return { ok: false, error: "not_submittable" };
    return { ok: false, error: "free_limit_reached" };
  }

  const outcome = await publishOrQueue(admin, lead.listing_id, settings, {}, { vouched: true });
  if (outcome.status === "error") {
    pLog.error(`publish of lead ${lead.id} failed`, { error: String((outcome.error as Error)?.message ?? outcome.error) });
    return { ok: false, error: "failed" };
  }

  await audit(admin, input.actorId, { action: "prospect.publish", targetType: "listing", targetId: lead.listing_id, note: `lead ${lead.id} · ${outcome.status}` });

  // Online: publishListing already marked the lead online and sent the SMS (src/lib/prospection/online.ts).
  // Held for an admin by the rules (or by « moderation_auto_publish » being off): the lead stays at « a dit oui »
  // with a note, and the same hook does both once the admin approves.
  if (outcome.status === "pending_review") {
    await addEvent(admin, lead.id, input.actorId, "note", { note: "pending_review" });
    return { ok: true, outcome: "pending_review", sms: null };
  }
  const after = await loadLead(admin, lead.id);
  const online = after ? await syncLeadWithListing(admin, after) : null;
  return {
    ok: true,
    outcome: "published",
    sms: online?.sms_sent_at ? { sent: true } : { sent: false, error: online?.sms_error ?? undefined },
  };
}

// ── The owner's private link, and the SMS that carries it ───────────────────

export type ManagedListing = { id: string; seller_id: string; status: string; title: string; deal_type: string | null };

/** The annonce a private link opens, or null when the link is wrong, old, or the annonce gone. */
export async function findManagedListing(admin: Admin, token: string): Promise<ManagedListing | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const { data: row } = await admin
    .from("listing_manage_tokens")
    .select("listing_id, seller_id, expires_at")
    .eq("token_hash", tokenHash(token))
    .maybeSingle();
  if (!row || new Date(row.expires_at as string).getTime() < Date.now()) return null;
  const { data: listing } = await admin
    .from("listings")
    .select("id, seller_id, status, title, deal_type")
    .eq("id", row.listing_id)
    .eq("seller_id", row.seller_id)
    .maybeSingle();
  return (listing as ManagedListing | null) ?? null;
}

export async function touchManageToken(admin: Admin, token: string): Promise<void> {
  await admin.from("listing_manage_tokens").update({ last_used_at: new Date().toISOString() }).eq("token_hash", tokenHash(token));
}

// ── The first message ───────────────────────────────────────────────────────

/** The message that asks the owner for their yes, filled in for this lead. */
export async function askMessage(lead: LeadRow, origin: string): Promise<string> {
  const s = await getSettings();
  return fillTemplate(lead.language === "fr" ? s.prospect_ask_fr : s.prospect_ask_ar, {
    name: lead.poster_name,
    property: propertyLine(readDraft(lead.draft)),
    terms: `${origin}/${lead.language}/terms`,
  });
}

// ── The team's figures ──────────────────────────────────────────────────────

export type MemberFigures = { actorId: string; contacted: number; yes: number; online: number };

/** Per member, since a date: first contacts, yeses, annonces put online. */
export async function teamFigures(admin: Admin, sinceIso: string): Promise<MemberFigures[]> {
  const { data } = await admin
    .from("prospect_events")
    .select("actor_id, kind")
    .in("kind", ["contacted", "confirmed", "published"])
    .gte("created_at", sinceIso)
    .not("actor_id", "is", null)
    .limit(20_000);
  const by = new Map<string, MemberFigures>();
  for (const r of (data ?? []) as { actor_id: string; kind: string }[]) {
    const m = by.get(r.actor_id) ?? { actorId: r.actor_id, contacted: 0, yes: 0, online: 0 };
    if (r.kind === "contacted") m.contacted++;
    else if (r.kind === "confirmed") m.yes++;
    else m.online++;
    by.set(r.actor_id, m);
  }
  return [...by.values()].sort((a, b) => b.contacted - a.contacted);
}
