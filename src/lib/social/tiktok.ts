/**
 * The few TikTok API calls the Social Publisher makes (developers.tiktok.com,
 * read 2026-11-15): Login Kit for Web to connect @mazedimmo, and the Content
 * Posting API to post an annonce's photos as a Photo Mode post.
 *
 *   connect    https://www.tiktok.com/v2/auth/authorize/   (code)
 *              POST /v2/oauth/token/   grant_type=authorization_code
 *   refresh    POST /v2/oauth/token/   grant_type=refresh_token — the access
 *              token lasts 2 h, the refresh token 180 days, and every refresh
 *              hands a NEW refresh token: the old one stops working.
 *   who        POST /v2/post/publish/creator_info/query/   nickname, username,
 *              the privacy levels the account may post with
 *   post       POST /v2/post/publish/content/init/   media_type PHOTO,
 *              source PULL_FROM_URL — TikTok downloads the photos itself, from
 *              a domain or URL prefix verified in the app's settings (Supabase
 *              storage cannot be, so they come from /api/social/image)
 *   status     POST /v2/post/publish/status/fetch/   PROCESSING_DOWNLOAD →
 *              PUBLISH_COMPLETE (or SEND_TO_USER_INBOX for a draft, or FAILED)
 *
 * Until TikTok audits the app, a direct post can only be SELF_ONLY, and only
 * to an account set to private (`unaudited_client_can_only_post_to_private_accounts`).
 * A draft (MEDIA_UPLOAD) lands in the TikTok app's inbox, where a person
 * finishes and posts it.
 *
 * Errors are GraphErrors (meta.ts), sorted into the same kinds, so the engine
 * and its retry policy (policy.ts) treat both networks alike; `code` carries
 * TikTok's own code (« access_token_invalid »…).
 */
import { GraphError, type Fetch, type GraphErrorKind } from "./meta";
import { timeoutSignal } from "@/lib/timeoutSignal";

export const TIKTOK_AUTH = "https://www.tiktok.com/v2/auth/authorize/";
export const TIKTOK_API = "https://open.tiktokapis.com";

/**
 * user.info.basic  the account's open_id and display name
 * video.publish    a direct post, and creator_info (nickname, username, privacy)
 * video.upload     a draft sent to the TikTok app's inbox
 */
export const TIKTOK_SCOPES = ["user.info.basic", "video.publish", "video.upload"] as const;

export type TiktokPrivacy = "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY";

/** TikTok's codes, sorted by what the engine can do about them. */
export function classifyTiktokError(status: number, code: string | null | undefined): GraphErrorKind {
  switch (code) {
    case "access_token_invalid":
    case "scope_not_authorized":
    case "scope_permission_missed":
    case "invalid_grant":
    case "invalid_client":
    case "unauthorized_client":
    case "auth_removed":
      return "auth";
    case "rate_limit_exceeded":
    case "spam_risk_too_many_posts":
    case "spam_risk_too_many_pending_share":
    case "reached_active_user_cap":
      return "rate_limit";
    case "photo_pull_failed":
    case "picture_size_check_failed":
    case "file_format_check_failed":
      return "media";
    case "internal_error":
    case "internal":
    case "server_error":
    case "temporarily_unavailable":
      return "transient";
  }
  if (status === 401) return "auth";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "transient";
  // invalid_param, url_ownership_unverified, privacy_level_option_mismatch,
  // unaudited_client_can_only_post_to_private_accounts, spam_risk_user_banned_from_posting…
  return "permanent";
}

export class TiktokError extends GraphError {
  constructor(message: string, kind: GraphErrorKind, readonly tiktokCode: string | null, status: number | null = null) {
    super(message, kind, null, null, status);
    this.name = "TiktokError";
  }
}

/** Until the audit: a direct post needs the account to be private, and then only SELF_ONLY. */
export function isUnauditedRefusal(err: unknown): boolean {
  return err instanceof TiktokError && err.tiktokCode === "unaudited_client_can_only_post_to_private_accounts";
}

type Envelope<T> = { data?: T; error?: { code?: string; message?: string; log_id?: string } };

/**
 * JSON, with the post ids kept whole: they are int64 (19 digits), which
 * JSON.parse would round to the nearest double — a link to someone else's
 * post. Long runs of digits in that list are read as text.
 */
export function parseKeepingIds(text: string): unknown {
  const safe = text.replace(/("publicaly_available_post_id"\s*:\s*\[)([^\]]*)\]/g, (_m, head: string, ids: string) =>
    `${head}${ids.replace(/(?<!")\b(\d{16,})\b(?!")/g, '"$1"')}]`,
  );
  try {
    return JSON.parse(safe);
  } catch {
    return {};
  }
}

export type TiktokClient = {
  get<T>(path: string, params?: Record<string, string>): Promise<T>;
  post<T>(path: string, body?: Record<string, unknown>): Promise<T>;
};

/** Calls made with one access token; every answer is { data, error: { code: "ok" } }. */
export function tiktokClient(token: string, opts: { fetch?: Fetch; base?: string; timeoutMs?: number } = {}): TiktokClient {
  const doFetch = opts.fetch ?? fetch;
  const base = opts.base ?? TIKTOK_API;

  async function call<T>(method: "GET" | "POST", path: string, body?: Record<string, unknown>, params?: Record<string, string>): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}${params ? `?${new URLSearchParams(params)}` : ""}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(method === "POST" ? { "Content-Type": "application/json; charset=UTF-8" } : {}),
        },
        body: method === "POST" && body ? JSON.stringify(body) : undefined,
        signal: timeoutSignal(opts.timeoutMs ?? 25_000),
        cache: "no-store",
      });
    } catch (err) {
      throw new TiktokError(err instanceof Error ? err.message : "network error", "network", null);
    }
    const json = parseKeepingIds(await res.text().catch(() => "")) as Envelope<T>;
    const code = json.error?.code ?? null;
    if (!res.ok || (code && code !== "ok")) {
      const message = `${code ?? `HTTP ${res.status}`}${json.error?.message ? `: ${json.error.message}` : ""}`;
      throw new TiktokError(message, classifyTiktokError(res.status, code), code, res.status);
    }
    return (json.data ?? {}) as T;
  }

  return {
    get: (path, params) => call("GET", path, undefined, params),
    post: (path, body) => call("POST", path, body),
  };
}

// ── Login Kit ─────────────────────────────────────────────────────────────

/** TikTok's consent page. The redirect URI must be one registered in the app, exactly. */
export function tiktokAuthorizeUrl(opts: { clientKey: string; redirectUri: string; state: string }): string {
  const q = new URLSearchParams({
    client_key: opts.clientKey,
    scope: TIKTOK_SCOPES.join(","),
    response_type: "code",
    redirect_uri: opts.redirectUri,
    state: opts.state,
  });
  return `${TIKTOK_AUTH}?${q}`;
}

export type TiktokTokens = {
  accessToken: string;
  /** Epoch ms. */
  accessExpiresAt: number;
  refreshToken: string;
  /** Epoch ms; the connection ends then. */
  refreshExpiresAt: number;
  openId: string;
  scopes: string[];
};

type TokenAnswer = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_expires_in?: number;
  open_id?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function tokenCall(params: Record<string, string>, doFetch: Fetch, now: number): Promise<TiktokTokens> {
  let res: Response;
  try {
    res = await doFetch(`${TIKTOK_API}/v2/oauth/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
      signal: timeoutSignal(20_000),
      cache: "no-store",
    });
  } catch (err) {
    throw new TiktokError(err instanceof Error ? err.message : "network error", "network", null);
  }
  const json = (await res.json().catch(() => ({}))) as TokenAnswer;
  if (!res.ok || json.error || !json.access_token || !json.refresh_token || !json.open_id) {
    const code = json.error ?? null;
    throw new TiktokError(
      `${code ?? `HTTP ${res.status}`}${json.error_description ? `: ${json.error_description}` : ""}`,
      classifyTiktokError(res.status, code),
      code,
      res.status,
    );
  }
  return {
    accessToken: json.access_token,
    accessExpiresAt: now + (json.expires_in ?? 7200) * 1000,
    refreshToken: json.refresh_token,
    refreshExpiresAt: now + (json.refresh_expires_in ?? 180 * 86_400) * 1000,
    openId: json.open_id,
    scopes: (json.scope ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  };
}

export type TiktokApp = { clientKey: string; clientSecret: string };

/** The code TikTok sent back → the account's tokens. */
export function tiktokTokensFromCode(
  app: TiktokApp & { redirectUri: string; code: string },
  doFetch: Fetch = fetch,
  now: number = Date.now(),
): Promise<TiktokTokens> {
  return tokenCall(
    {
      client_key: app.clientKey,
      client_secret: app.clientSecret,
      code: app.code,
      grant_type: "authorization_code",
      redirect_uri: app.redirectUri,
    },
    doFetch,
    now,
  );
}

/** A new access token — and a new refresh token, which replaces the old one. */
export function refreshTiktokTokens(
  app: TiktokApp & { refreshToken: string },
  doFetch: Fetch = fetch,
  now: number = Date.now(),
): Promise<TiktokTokens> {
  return tokenCall(
    { client_key: app.clientKey, client_secret: app.clientSecret, grant_type: "refresh_token", refresh_token: app.refreshToken },
    doFetch,
    now,
  );
}

/** Ends the connection on TikTok's side too (best effort: the stored token is erased anyway). */
export async function revokeTiktokToken(app: TiktokApp & { token: string }, doFetch: Fetch = fetch): Promise<void> {
  await doFetch(`${TIKTOK_API}/v2/oauth/revoke/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_key: app.clientKey, client_secret: app.clientSecret, token: app.token }),
    signal: timeoutSignal(10_000),
    cache: "no-store",
  }).catch(() => null);
}

// ── Content Posting API ───────────────────────────────────────────────────

export type CreatorInfo = {
  username: string | null;
  nickname: string | null;
  privacyOptions: TiktokPrivacy[];
  commentDisabled: boolean;
};

/** Who the token posts as, and how it may post. Asked before every post, as TikTok requires. */
export async function tiktokCreatorInfo(c: TiktokClient): Promise<CreatorInfo> {
  const d = await c.post<{
    creator_username?: string;
    creator_nickname?: string;
    privacy_level_options?: TiktokPrivacy[];
    comment_disabled?: boolean;
  }>("/v2/post/publish/creator_info/query/");
  return {
    username: d.creator_username ?? null,
    nickname: d.creator_nickname ?? null,
    privacyOptions: d.privacy_level_options ?? [],
    commentDisabled: d.comment_disabled === true,
  };
}

/** The account's display name (user.info.basic), for an app without Direct Post. */
export async function tiktokDisplayName(c: TiktokClient): Promise<string | null> {
  const d = await c.get<{ user?: { display_name?: string } }>("/v2/user/info/", { fields: "open_id,display_name" });
  return d.user?.display_name ?? null;
}

/**
 * The privacy a direct post goes out with: public when the switch says so
 * and TikTok offers it, otherwise « only me » (all an app TikTok has not
 * audited may use). Null when the account offers neither.
 */
export function pickPrivacy(options: readonly TiktokPrivacy[], wantPublic: boolean): TiktokPrivacy | null {
  if (wantPublic && options.includes("PUBLIC_TO_EVERYONE")) return "PUBLIC_TO_EVERYONE";
  if (options.includes("SELF_ONLY")) return "SELF_ONLY";
  return null;
}

export type PhotoPost = {
  title: string;
  description: string;
  imageUrls: string[];
  /** A draft in the TikTok app's inbox (MEDIA_UPLOAD) instead of a post. */
  draft: boolean;
  /** Direct posts only. */
  privacy?: TiktokPrivacy;
  disableComment?: boolean;
  autoAddMusic?: boolean;
};

/** TikTok's Photo Mode takes 35 photos at most. */
export const TIKTOK_MAX_PHOTOS = 35;

/** Starts the post; TikTok downloads the photos after. Returns the publish_id to follow it with. */
export async function initTiktokPhotoPost(c: TiktokClient, input: PhotoPost): Promise<string> {
  const urls = input.imageUrls.slice(0, TIKTOK_MAX_PHOTOS);
  if (urls.length === 0) throw new TiktokError("TikTok needs at least one photo", "media", "no_photo");
  const postInfo: Record<string, unknown> = {
    title: input.title,
    description: input.description,
  };
  if (!input.draft) {
    if (!input.privacy) throw new TiktokError("no privacy level TikTok accepts for this account", "permanent", "privacy_level_option_mismatch");
    postInfo.privacy_level = input.privacy;
    postInfo.disable_comment = input.disableComment ?? false;
    postInfo.auto_add_music = input.autoAddMusic ?? true;
    // An agency's own listing: neither a paid partnership nor a brand's promotion of a third party.
    postInfo.brand_content_toggle = false;
    postInfo.brand_organic_toggle = false;
  }
  const d = await c.post<{ publish_id?: string }>("/v2/post/publish/content/init/", {
    post_info: postInfo,
    source_info: { source: "PULL_FROM_URL", photo_cover_index: 0, photo_images: urls },
    post_mode: input.draft ? "MEDIA_UPLOAD" : "DIRECT_POST",
    media_type: "PHOTO",
  });
  if (!d.publish_id) throw new TiktokError("TikTok gave no publish_id", "transient", null);
  return d.publish_id;
}

export type TiktokStatus = "PROCESSING_DOWNLOAD" | "PROCESSING_UPLOAD" | "SEND_TO_USER_INBOX" | "PUBLISH_COMPLETE" | "FAILED";

export type PublishState = { status: TiktokStatus; failReason: string | null; postIds: string[] };

export async function tiktokPublishStatus(c: TiktokClient, publishId: string): Promise<PublishState> {
  const d = await c.post<{ status?: TiktokStatus; fail_reason?: string; publicaly_available_post_id?: (string | number)[] }>(
    "/v2/post/publish/status/fetch/",
    { publish_id: publishId },
  );
  return {
    status: d.status ?? "PROCESSING_DOWNLOAD",
    failReason: d.fail_reason ?? null,
    // TikTok spells it « publicaly »; int64 ids, read as text so none is rounded.
    postIds: (d.publicaly_available_post_id ?? []).map(String),
  };
}

/**
 * The address of a public photo post. TikTok gives a post's id only once it
 * is public and moderated; a private post has none, and so no link.
 */
export function tiktokPostUrl(username: string | null, postId: string | null): string | null {
  if (!postId || !username) return null;
  return `https://www.tiktok.com/@${username.replace(/^@/, "")}/photo/${postId}`;
}
