/**
 * The site proposes the annonces that go online on Mazed's pages by itself
 * (the owner, 2026-11-09: every annonce that goes out lands on the « Mazed »
 * page and its 116 000 followers, even when the seller did not ask, so that he
 * sees it and decides).
 *
 * It only proposes. Each annonce becomes an ask waiting in « À valider » —
 * texts generated, nothing posted — exactly as when an admin puts one forward
 * from the annonce (createFeaturedRequest); the owner reads it, edits it,
 * approves or refuses. The seller's CGU (2026-11-05) stand for their consent,
 * so an annonce whose seller has not accepted them yet is left alone and is
 * picked up on a later run, once they have.
 *
 * Run by the Social Publisher's worker every five minutes (api/cron/social-publish).
 */
import type { getServiceSupabase } from "@/lib/supabase/admin";
import { loadSettings } from "@/lib/settings/server";
import { currentConsents, type ConsentRow } from "@/lib/consents/model";
import { FEATURED_CHANNELS, type SocialChannel } from "./channels";
import { createFeaturedRequest, termsCoverFeaturing } from "./server";

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

/** The most asks one run makes, so a first run never floods the console. */
const PER_RUN = 10;
/** How many online annonces one run looks at, the newest first. */
const LOOKED_AT = 500;

export type AutoQueueSettings = {
  enabled: boolean;
  channels: SocialChannel[];
  days: number;
  waitingMax: number;
  minPhotos: number;
};

/** The channels the three switches name, in the console's usual order. */
export function autoQueueChannels(on: { mazed: boolean; page: boolean; instagram: boolean }): SocialChannel[] {
  const wanted: Record<string, boolean> = { facebook_mazed: on.mazed, facebook_page: on.page, instagram: on.instagram };
  return FEATURED_CHANNELS.filter((c) => wanted[c]);
}

export type AutoQueueCandidate = { id: string; seller_id: string; photos: number };

/**
 * Which of the annonces to propose now, in the order given (the sweep gives
 * the newest first): not already asked about (in any state — a refused ask is
 * an answer, it is not asked again), a seller whose CGU cover it, enough
 * photos, and no more than the room the waiting list has left.
 */
export function pickAutoQueue(
  candidates: readonly AutoQueueCandidate[],
  rules: { asked: ReadonlySet<string>; covered: ReadonlySet<string>; minPhotos: number; room: number },
): string[] {
  const picked: string[] = [];
  const limit = Math.min(Math.max(0, rules.room), PER_RUN);
  for (const c of candidates) {
    if (picked.length >= limit) break;
    if (rules.asked.has(c.id)) continue;
    if (!rules.covered.has(c.seller_id)) continue;
    if (c.photos < rules.minPhotos) continue;
    picked.push(c.id);
  }
  return picked;
}

export async function autoQueueSettings(admin: Admin): Promise<AutoQueueSettings> {
  const s = await loadSettings(admin);
  return {
    enabled: s.social_enabled && s.social_auto_queue,
    channels: autoQueueChannels({ mazed: s.social_auto_queue_mazed, page: s.social_auto_queue_page, instagram: s.social_auto_queue_instagram }),
    days: s.social_auto_queue_days,
    waitingMax: s.social_auto_queue_waiting_max,
    minPhotos: s.social_auto_queue_min_photos,
  };
}

/** Sellers (among these) whose latest CGU answer lets Mazed put their annonce forward — one query, not one per seller. */
async function sellersCovered(admin: Admin, sellerIds: string[]): Promise<Set<string>> {
  const covered = new Set<string>();
  if (sellerIds.length === 0) return covered;
  const { data } = await admin
    .from("user_consents")
    .select("user_id, kind, granted, version, source, created_at")
    .eq("kind", "terms")
    .in("user_id", sellerIds)
    .order("created_at", { ascending: false })
    .limit(2000);
  const byUser = new Map<string, ConsentRow[]>();
  for (const r of (data ?? []) as (ConsentRow & { user_id: string })[]) {
    const list = byUser.get(r.user_id) ?? [];
    list.push(r);
    byUser.set(r.user_id, list);
  }
  for (const [id, rows] of byUser) if (termsCoverFeaturing(currentConsents(rows).terms)) covered.add(id);
  return covered;
}

type OnlineAnnonce = { id: string; seller_id: string; title: string; photos: { id: string }[] | null };

/** The online annonces of the last `days` days, newest first, and which of them already have an ask (in any state). */
async function recentAnnonces(admin: Admin, days: number, now: Date): Promise<{ rows: OnlineAnnonce[]; asked: Set<string> }> {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const { data } = await admin
    .from("listings")
    .select("id, seller_id, title, photos:listing_photos (id)")
    .eq("status", "published")
    .gte("published_at", since)
    .order("published_at", { ascending: false })
    .limit(LOOKED_AT);
  const rows = (data ?? []) as unknown as OnlineAnnonce[];
  if (rows.length === 0) return { rows, asked: new Set() };
  const { data: askedRows } = await admin
    .from("social_publication_requests")
    .select("listing_id")
    .in("listing_id", rows.map((r) => r.id));
  return { rows, asked: new Set(((askedRows ?? []) as { listing_id: string }[]).map((r) => r.listing_id)) };
}

export type WaitingSeller = { seller_id: string; full_name: string | null; phone: string | null; annonces: number };

/**
 * Who the proposals wait for: the sellers with online annonces that were not
 * proposed because they have not accepted the CGU of 2026-11-05 yet (the
 * banner shows on their next visit). The console lists them, so the owner
 * sees every annonce that is held back and whom to ask.
 */
export async function sellersWaitingForTerms(admin: Admin, opts: { now?: Date } = {}): Promise<WaitingSeller[]> {
  const settings = await autoQueueSettings(admin);
  const { rows, asked } = await recentAnnonces(admin, settings.days, opts.now ?? new Date());
  const open = rows.filter((r) => !asked.has(r.id));
  const sellerIds = [...new Set(open.map((r) => r.seller_id))];
  const covered = await sellersCovered(admin, sellerIds);
  const counts = new Map<string, number>();
  for (const r of open) if (!covered.has(r.seller_id)) counts.set(r.seller_id, (counts.get(r.seller_id) ?? 0) + 1);
  if (counts.size === 0) return [];
  const { data: people } = await admin.from("profiles").select("id, full_name, phone").in("id", [...counts.keys()]);
  const byId = new Map(((people ?? []) as { id: string; full_name: string | null; phone: string | null }[]).map((p) => [p.id, p]));
  return [...counts]
    .map(([seller_id, annonces]) => ({ seller_id, full_name: byId.get(seller_id)?.full_name ?? null, phone: byId.get(seller_id)?.phone ?? null, annonces }))
    .sort((a, b) => b.annonces - a.annonces);
}

export type AutoQueueResult = { queued: number; off?: true; full?: true };

export async function queueFeaturedListings(
  admin: Admin,
  opts: { origin?: string | null; now?: Date } = {},
): Promise<AutoQueueResult> {
  const settings = await autoQueueSettings(admin);
  if (!settings.enabled || settings.channels.length === 0) return { queued: 0, off: true };

  // The waiting list has a ceiling: an owner who is away does not come back to hundreds of asks.
  const { count: waiting } = await admin
    .from("social_publication_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending_approval");
  const room = settings.waitingMax - (waiting ?? 0);
  if (room <= 0) return { queued: 0, full: true };

  const { rows, asked } = await recentAnnonces(admin, settings.days, opts.now ?? new Date());
  if (rows.length === 0) return { queued: 0 };

  const open = rows.filter((r) => !asked.has(r.id));
  const covered = await sellersCovered(admin, [...new Set(open.map((r) => r.seller_id))]);
  const ids = pickAutoQueue(
    rows.map((r) => ({ id: r.id, seller_id: r.seller_id, photos: r.photos?.length ?? 0 })),
    { asked, covered, minPhotos: settings.minPhotos, room },
  );

  const titles: string[] = [];
  for (const id of ids) {
    const made = await createFeaturedRequest(admin, {
      adminId: null,
      listingId: id,
      channels: settings.channels,
      language: "both",
      origin: opts.origin,
    });
    if (made.ok) titles.push(rows.find((r) => r.id === id)?.title ?? "");
  }

  // One notice for the run, not one per annonce.
  if (titles.length > 0) {
    await admin
      .rpc("_notify_admins", {
        p_kind: "admin_social_pending",
        p_title: "Promotion à valider",
        p_body: titles.length === 1 ? `« ${titles[0]} » — à publier sur les réseaux.` : `${titles.length} annonces — à publier sur les réseaux.`,
        p_link: "/admin/social",
        p_payload: { vars: { title: titles.length === 1 ? titles[0] : `${titles.length} annonces` } },
      })
      .then(() => {}, () => {});
  }
  return { queued: titles.length };
}
