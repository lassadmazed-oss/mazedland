/**
 * Deleting an account or an agence from the console (the owner, 2026-11-03:
 * « فما اجونس ماهيش اكتيفي نحبو نربحو اسباس » — agences and accounts that do
 * nothing take room; a button to delete them).
 *
 * Deleting frees the room for real: the annonces go with their photos, an
 * agence with its logo, cover, project covers and papers, and the founding
 * place it held comes back. What the law keeps is kept: a payment and its
 * invoice are never deleted (invoices never are — a wrong one gets a credit
 * note), so an account that ever paid is anonymised and locked instead of
 * erased, like a person deleting themselves (request_account_deletion, 0199).
 *
 * Refused while money is in flight (a receipt waiting, a paid period still
 * running): the console suspends those instead.
 */
import type { getServiceSupabase } from "@/lib/supabase/admin";

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

export type ShopBlocker = "paid_plan" | "payment_pending";
export type AccountBlocker = "admin" | "self" | "payment_pending" | "owns_shop";

/** Why an agence cannot be deleted now, if anything stops it. */
export function shopBlocker(s: { paidUntil: Date | null; now: Date; pendingPayments: number }): ShopBlocker | null {
  if (s.pendingPayments > 0) return "payment_pending";
  if (s.paidUntil && s.paidUntil.getTime() > s.now.getTime()) return "paid_plan";
  return null;
}

/** Why an account cannot be deleted now, if anything stops it. */
export function accountBlocker(a: { isAdmin: boolean; isSelf: boolean; pendingPayments: number; ownsShop: boolean }): AccountBlocker | null {
  if (a.isSelf) return "self";
  if (a.isAdmin) return "admin";
  if (a.pendingPayments > 0) return "payment_pending";
  if (a.ownsShop) return "owns_shop";
  return null;
}

/** Erased when nothing of the account must be kept; anonymised when it paid (its invoices stay). */
export function accountMode(a: { payments: number; invoices: number }): "erase" | "anonymise" {
  return a.payments > 0 || a.invoices > 0 ? "anonymise" : "erase";
}

const chunks = <T>(xs: readonly T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n));

/** Files gone from a bucket, best effort: a stray file costs little, and never undoes a delete. */
async function removeFiles(admin: Admin, bucket: string, paths: readonly (string | null | undefined)[]): Promise<number> {
  const clean = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  let removed = 0;
  for (const part of chunks(clean, 100)) {
    const { data } = await admin.storage.from(bucket).remove(part).catch(() => ({ data: null }));
    removed += data?.length ?? 0;
  }
  return removed;
}

/** These annonces, their photo rows (by cascade) and their photo files. */
export async function deleteListings(admin: Admin, ids: readonly string[]): Promise<{ listings: number; photos: number; error?: unknown }> {
  if (ids.length === 0) return { listings: 0, photos: 0 };
  const paths: string[] = [];
  for (const part of chunks(ids, 200)) {
    const { data } = await admin.from("listing_photos").select("storage_path").in("listing_id", part);
    paths.push(...((data ?? []) as { storage_path: string | null }[]).map((r) => r.storage_path ?? "").filter(Boolean));
  }
  let listings = 0;
  for (const part of chunks(ids, 200)) {
    const { data, error } = await admin.from("listings").delete().in("id", part).select("id");
    if (error) return { listings, photos: 0, error };
    listings += data?.length ?? 0;
  }
  return { listings, photos: await removeFiles(admin, "properties", paths) };
}

export type ShopDeletion =
  | { ok: true; name: string; listings: number; photos: number; documents: number }
  | { ok: false; blocker: ShopBlocker; until?: string }
  | { ok: false; error: unknown };

/** The agence, its annonces, projects, members' places in it, periods, papers and pictures. Not its owner's account. */
export async function deleteShop(admin: Admin, shopId: string, now: Date = new Date()): Promise<ShopDeletion> {
  const { data: shop, error: readErr } = await admin.from("shops").select("id, name, logo_path, cover_path").eq("id", shopId).maybeSingle();
  if (readErr || !shop) return { ok: false, error: readErr ?? new Error("shop_not_found") };

  const [{ data: paid }, { count: pending }] = await Promise.all([
    admin
      .from("shop_subscriptions")
      .select("ends_at")
      .eq("shop_id", shopId)
      .eq("status", "active")
      .not("payment_id", "is", null)
      .gt("ends_at", now.toISOString()),
    admin
      .from("payments")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "pending_review"])
      .contains("metadata", { shop_id: shopId }),
  ]);
  const paidUntil = ((paid ?? []) as { ends_at: string }[]).reduce<Date | null>((max, r) => {
    const d = new Date(r.ends_at);
    return !max || d > max ? d : max;
  }, null);
  const blocker = shopBlocker({ paidUntil, now, pendingPayments: pending ?? 0 });
  if (blocker) return { ok: false, blocker, ...(blocker === "paid_plan" && paidUntil ? { until: paidUntil.toISOString() } : {}) };

  const [{ data: listingRows }, { data: docs }, { data: projects }] = await Promise.all([
    admin.from("listings").select("id").eq("shop_id", shopId),
    admin.from("shop_documents").select("storage_path").eq("shop_id", shopId),
    admin.from("projects").select("cover_path").eq("shop_id", shopId),
  ]);
  const gone = await deleteListings(admin, ((listingRows ?? []) as { id: string }[]).map((l) => l.id));
  if (gone.error) return { ok: false, error: gone.error };

  // Members, periods (the founding gift with them: its place comes back),
  // papers, projects and clients go by cascade (0173, 0174, 0179).
  const { error } = await admin.from("shops").delete().eq("id", shopId);
  if (error) return { ok: false, error };

  const documents = await removeFiles(admin, "shop-documents", ((docs ?? []) as { storage_path: string | null }[]).map((d) => d.storage_path));
  await removeFiles(admin, "properties", [
    shop.logo_path as string | null,
    shop.cover_path as string | null,
    ...((projects ?? []) as { cover_path: string | null }[]).map((p) => p.cover_path),
  ]);
  return { ok: true, name: shop.name as string, listings: gone.listings, photos: gone.photos, documents };
}

export type AccountDeletion =
  | { ok: true; mode: "erase" | "anonymise"; name: string; listings: number; photos: number }
  | { ok: false; blocker: AccountBlocker; shop?: string }
  | { ok: false; error: unknown };

/**
 * The account and everything it put on the site. Erased when it never paid;
 * otherwise anonymised and locked, its payments and invoices kept for the
 * accounts (they point at it and are never deleted).
 */
export async function deleteAccount(admin: Admin, userId: string, byId: string): Promise<AccountDeletion> {
  const { data: profile, error: readErr } = await admin.from("profiles").select("id, full_name, role").eq("id", userId).maybeSingle();
  if (readErr || !profile) return { ok: false, error: readErr ?? new Error("profile_not_found") };

  const [{ count: pending }, { data: owned }, { count: payments }, { count: invoices }] = await Promise.all([
    admin.from("payments").select("id", { count: "exact", head: true }).eq("user_id", userId).in("status", ["pending", "pending_review"]),
    admin.from("shops").select("name").eq("owner_id", userId).limit(1),
    admin.from("payments").select("id", { count: "exact", head: true }).eq("user_id", userId),
    admin.from("invoices").select("id", { count: "exact", head: true }).eq("user_id", userId),
  ]);
  const shop = ((owned ?? []) as { name: string }[])[0]?.name;
  const blocker = accountBlocker({ isAdmin: profile.role === "admin", isSelf: userId === byId, pendingPayments: pending ?? 0, ownsShop: Boolean(shop) });
  if (blocker) return { ok: false, blocker, ...(blocker === "owns_shop" ? { shop } : {}) };

  const name = (profile.full_name as string | null) ?? "";
  const { data: listingRows } = await admin.from("listings").select("id").eq("seller_id", userId);
  const gone = await deleteListings(admin, ((listingRows ?? []) as { id: string }[]).map((l) => l.id));
  if (gone.error) return { ok: false, error: gone.error };

  if (accountMode({ payments: payments ?? 0, invoices: invoices ?? 0 }) === "erase") {
    // The profile and what hangs on it (notifications, demandes, favourites,
    // memberships, consents…) go by cascade from the login.
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (!error) return { ok: true, mode: "erase", name, listings: gone.listings, photos: gone.photos };
    // Something still points at it (an old moderation stamp): anonymised instead.
  }

  const anonymised = await anonymise(admin, userId);
  if (anonymised.error) return { ok: false, error: anonymised.error };
  return { ok: true, mode: "anonymise", name, listings: gone.listings, photos: gone.photos };
}

/** What request_account_deletion does for a person, done for them: nothing left that names them, no way to sign in. */
async function anonymise(admin: Admin, userId: string): Promise<{ error?: unknown }> {
  const { error } = await admin
    .from("profiles")
    .update({ deleted_at: new Date().toISOString(), full_name: "Compte supprimé", phone: null })
    .eq("id", userId);
  if (error) return { error };
  await Promise.all([
    admin.from("property_requests").delete().eq("user_id", userId),
    admin.from("watchlist").delete().eq("user_id", userId),
    admin.from("notifications").delete().eq("user_id", userId),
    admin.from("user_consents").delete().eq("user_id", userId),
    admin.from("shop_members").delete().eq("user_id", userId),
    admin.from("visit_requests").update({ buyer_name: "Compte supprimé", buyer_phone: null, message: null }).eq("buyer_id", userId),
    admin.from("leads").update({ name: "Compte supprimé", phone: null }).eq("buyer_id", userId),
  ]);
  // The login: no e-mail, phone or name left in it, and locked for good.
  const { data: before } = await admin.auth.admin.getUserById(userId);
  const wipe = Object.fromEntries(Object.keys(before?.user?.user_metadata ?? {}).map((k) => [k, null]));
  const { error: authErr } = await admin.auth.admin.updateUserById(userId, {
    email: `deleted+${userId}@deleted.invalid`,
    phone: "",
    user_metadata: wipe,
    ban_duration: "876000h",
  });
  return authErr ? { error: authErr } : {};
}
