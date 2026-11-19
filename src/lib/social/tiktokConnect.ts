/**
 * Connecting Mazed Immo's TikTok account (@mazed613) and keeping its token
 * alive — what the routes and the engine need, in one place.
 *
 * Needs, in the environment (never in the browser):
 *   TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET   the TikTok app (developers.tiktok.com)
 *   SOCIAL_TOKEN_KEY                          the key that seals the tokens (crypto.ts)
 * Until both TikTok keys are there, « Connecter TikTok » explains what is
 * missing and TikTok posts wait as tasks for a person, as Facebook's did
 * before the Meta app.
 *
 * The redirect URI to register in the TikTok app (Login Kit) is the address
 * the admin uses + /api/admin/social/tiktok/callback — on the site,
 * https://www.mazed.immo/api/admin/social/tiktok/callback. TikTok takes https
 * only, so this is not tried from localhost.
 *
 * The tokens: the access token lasts 2 hours, the refresh token 180 days,
 * and each refresh hands a new refresh token — the old one dies. Both are
 * sealed together in social_accounts.token_sealed, and token_expires_at is
 * the refresh token's end (when the connection really ends; the console
 * shows it). The engine takes a fresh access token through
 * tiktokAccessToken(), which refreshes it when it has under 10 minutes left.
 */
import type { getServiceSupabase } from "@/lib/supabase/admin";
import { hasTokenKey, openToken, sealToken } from "./crypto";
import { requeueWaitingJobs } from "./connect";
import type { Fetch } from "./meta";
import { refreshTiktokTokens, TiktokError, type CreatorInfo, type TiktokApp, type TiktokTokens } from "./tiktok";

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

export const TIKTOK_STATE_COOKIE = "mz_tiktok_state";
export const TIKTOK_COOKIE_PATH = "/api/admin/social/tiktok";

/** A token with less left than this is refreshed before it is used. */
export const REFRESH_MARGIN_MS = 10 * 60_000;

export function tiktokConfig(env: Record<string, string | undefined> = process.env): TiktokApp | null {
  const clientKey = env.TIKTOK_CLIENT_KEY?.trim();
  const clientSecret = env.TIKTOK_CLIENT_SECRET?.trim();
  if (!clientKey || !clientSecret || !hasTokenKey(env)) return null;
  return { clientKey, clientSecret };
}

/** What is missing before « Connecter TikTok » can work — shown in the console. */
export function missingTiktokConfig(env: Record<string, string | undefined> = process.env): string[] {
  const missing: string[] = [];
  if (!env.TIKTOK_CLIENT_KEY?.trim()) missing.push("TIKTOK_CLIENT_KEY");
  if (!env.TIKTOK_CLIENT_SECRET?.trim()) missing.push("TIKTOK_CLIENT_SECRET");
  if (!hasTokenKey(env)) missing.push("SOCIAL_TOKEN_KEY");
  return missing;
}

/** Where TikTok sends the admin back: the host they started from, where the state cookie lives. */
export function tiktokCallbackUrl(requestOrigin: string): string {
  return `${requestOrigin.replace(/\/+$/, "")}/api/admin/social/tiktok/callback`;
}

/** Whether the account is the one the social_tiktok_username setting names (empty: any). */
export function isWantedTiktok(username: string | null, wanted: string): boolean {
  const w = wanted.trim().replace(/^@/, "").toLowerCase();
  if (!w) return true;
  return (username ?? "").replace(/^@/, "").toLowerCase() === w;
}

type Bundle = { v: 1; a: string; ae: number; r: string; re: number; o: string; s: string[] };

/** Both tokens, sealed as one value. */
export function sealTiktokTokens(t: TiktokTokens, env: Record<string, string | undefined> = process.env): string {
  const b: Bundle = { v: 1, a: t.accessToken, ae: t.accessExpiresAt, r: t.refreshToken, re: t.refreshExpiresAt, o: t.openId, s: t.scopes };
  return sealToken(JSON.stringify(b), env);
}

export function openTiktokTokens(sealed: string, env: Record<string, string | undefined> = process.env): TiktokTokens {
  const b = JSON.parse(openToken(sealed, env)) as Partial<Bundle>;
  if (b.v !== 1 || !b.a || !b.r || typeof b.ae !== "number" || typeof b.re !== "number") throw new Error("sealed tiktok tokens: unknown format");
  return { accessToken: b.a, accessExpiresAt: b.ae, refreshToken: b.r, refreshExpiresAt: b.re, openId: b.o ?? "", scopes: b.s ?? [] };
}

/**
 * Store the connected account (tokens sealed) and put back in the queue the
 * TikTok posts that were waiting for one.
 */
export async function saveTiktokAccount(
  admin: Admin,
  input: { tokens: TiktokTokens; creator: Pick<CreatorInfo, "username" | "nickname">; adminId: string },
): Promise<string | null> {
  const now = new Date().toISOString();
  const { data } = await admin
    .from("social_accounts")
    .upsert(
      {
        platform: "tiktok",
        external_id: input.tokens.openId,
        name: (input.creator.nickname || input.creator.username || "TikTok").slice(0, 200),
        username: input.creator.username,
        parent_account_id: null,
        token_sealed: sealTiktokTokens(input.tokens),
        token_expires_at: new Date(input.tokens.refreshExpiresAt).toISOString(),
        scopes: input.tokens.scopes,
        status: "connected",
        last_error: null,
        last_checked_at: now,
        connected_by: input.adminId,
        connected_at: now,
      },
      { onConflict: "platform,external_id" },
    )
    .select("id")
    .single();
  await requeueWaitingJobs(admin);
  return (data?.id as string | undefined) ?? null;
}

export type TiktokAccountRow = {
  id: string;
  external_id: string;
  username: string | null;
  status: string;
  token_sealed: string | null;
  token_expires_at: string | null;
};

export type FreshToken =
  | { ok: true; token: string; account: TiktokAccountRow; refreshed: boolean }
  | { ok: false; error: "missing" | "expired" | "no_key" | "not_configured" };

/**
 * A working access token for the account, refreshed when it is about to run
 * out. The refresh token changes on every refresh and the old one dies, so
 * two runs refreshing at once would lock each other out: the new pair is
 * written only over the pair it replaced, and a refresh TikTok refuses is
 * checked against the stored row first — another run may have refreshed it
 * a moment ago. A refresh token TikTok no longer takes ends the connection
 * (« Reconnecter »); a network failure is thrown, for the engine to retry.
 */
export async function tiktokAccessToken(
  admin: Admin,
  accountId: string,
  deps: { fetch?: Fetch; now?: number; app?: TiktokApp | null } = {},
): Promise<FreshToken> {
  const now = deps.now ?? Date.now();
  const read = async () =>
    (
      await admin
        .from("social_accounts")
        .select("id, external_id, username, status, token_sealed, token_expires_at")
        .eq("id", accountId)
        .maybeSingle()
    ).data as TiktokAccountRow | null;

  const acc = await read();
  if (!acc) return { ok: false, error: "missing" };
  if (acc.status !== "connected" || !acc.token_sealed) return { ok: false, error: "expired" };
  let tokens: TiktokTokens;
  try {
    tokens = openTiktokTokens(acc.token_sealed);
  } catch {
    return { ok: false, error: "no_key" };
  }
  if (tokens.refreshExpiresAt <= now) {
    await admin.from("social_accounts").update({ status: "expired", last_error: "refresh token expired" }).eq("id", acc.id);
    return { ok: false, error: "expired" };
  }
  if (tokens.accessExpiresAt - now > REFRESH_MARGIN_MS) return { ok: true, token: tokens.accessToken, account: acc, refreshed: false };

  const app = deps.app === undefined ? tiktokConfig() : deps.app;
  if (!app) return { ok: false, error: "not_configured" };

  let next: TiktokTokens;
  try {
    next = await refreshTiktokTokens({ ...app, refreshToken: tokens.refreshToken }, deps.fetch, now);
  } catch (err) {
    // Refreshed by another run in the meantime? Then its token is the one to use.
    const again = await read();
    if (again?.token_sealed && again.token_sealed !== acc.token_sealed && again.status === "connected") {
      try {
        const theirs = openTiktokTokens(again.token_sealed);
        if (theirs.accessExpiresAt > now) return { ok: true, token: theirs.accessToken, account: again, refreshed: false };
      } catch {
        // fall through
      }
    }
    if (err instanceof TiktokError && err.kind === "auth") {
      await admin
        .from("social_accounts")
        .update({ status: "expired", last_error: err.message.slice(0, 500) })
        .eq("id", acc.id)
        .eq("token_sealed", acc.token_sealed);
      return { ok: false, error: "expired" };
    }
    throw err;
  }

  const sealed = sealTiktokTokens(next);
  const { data: written } = await admin
    .from("social_accounts")
    .update({ token_sealed: sealed, token_expires_at: new Date(next.refreshExpiresAt).toISOString(), last_error: null })
    .eq("id", acc.id)
    .eq("token_sealed", acc.token_sealed)
    .select("id")
    .maybeSingle();
  if (!written) {
    // Another run wrote its pair first; ours is still valid for this call.
    return { ok: true, token: next.accessToken, account: acc, refreshed: true };
  }
  return { ok: true, token: next.accessToken, account: { ...acc, token_sealed: sealed }, refreshed: true };
}
