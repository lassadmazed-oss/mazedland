import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import {
  classifyTiktokError, initTiktokPhotoPost, isUnauditedRefusal, parseKeepingIds, pickPrivacy, refreshTiktokTokens,
  tiktokAuthorizeUrl, tiktokClient, tiktokCreatorInfo, TiktokError, tiktokPostUrl, tiktokPublishStatus, tiktokTokensFromCode,
} from "./tiktok";
import { isWantedTiktok, missingTiktokConfig, openTiktokTokens, sealTiktokTokens, tiktokCallbackUrl, tiktokConfig } from "./tiktokConnect";
import { generatePost, socialListingFrom, tiktokCaption } from "./content";
import { FEATURED_CHANNELS, OFFERED_CHANNELS, isApiChannel, needsPhoto } from "./channels";
import { autoQueueChannels, withPhotosOnly } from "./autoqueue";
import type { Fetch } from "./meta";

type Call = { method: string; url: string; headers: Record<string, string>; body: string };

/** A TikTok stand-in: answers by « METHOD /path », records every call with its body as sent. */
function fakeTiktok(routes: Record<string, (body: string, call: Call) => { status?: number; json: unknown } | unknown>) {
  const calls: Call[] = [];
  const fetch: Fetch = async (input, init) => {
    const url = new URL(String(input));
    const call: Call = {
      method: init?.method ?? "GET",
      url: url.toString(),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body instanceof URLSearchParams ? init.body.toString() : typeof init?.body === "string" ? init.body : "",
    };
    calls.push(call);
    const handler = routes[`${call.method} ${url.pathname}`];
    if (!handler) return new Response(JSON.stringify({ error: { code: "not_found", message: "no route" } }), { status: 404 });
    const out = handler(call.body, call) as { status?: number; json?: unknown; raw?: string };
    if (out && typeof out === "object" && "raw" in out && typeof out.raw === "string") return new Response(out.raw, { status: out.status ?? 200 });
    if (out && typeof out === "object" && "json" in out) return new Response(JSON.stringify(out.json), { status: out.status ?? 200 });
    return new Response(JSON.stringify(out), { status: 200 });
  };
  return { fetch, calls };
}

const ok = (data: unknown) => ({ data, error: { code: "ok", message: "", log_id: "L" } });
const ENV = { TIKTOK_CLIENT_KEY: "ck", TIKTOK_CLIENT_SECRET: "cs", SOCIAL_TOKEN_KEY: randomBytes(32).toString("base64") };

describe("classifyTiktokError", () => {
  it("asks for a reconnection when the token or the grant is no good", () => {
    expect(classifyTiktokError(401, "access_token_invalid")).toBe("auth");
    expect(classifyTiktokError(401, "scope_not_authorized")).toBe("auth");
    expect(classifyTiktokError(400, "invalid_grant")).toBe("auth");
    expect(classifyTiktokError(200, "auth_removed")).toBe("auth");
  });
  it("waits on TikTok's ceilings", () => {
    expect(classifyTiktokError(429, "rate_limit_exceeded")).toBe("rate_limit");
    expect(classifyTiktokError(403, "spam_risk_too_many_posts")).toBe("rate_limit");
    expect(classifyTiktokError(403, "spam_risk_too_many_pending_share")).toBe("rate_limit");
    expect(classifyTiktokError(403, "reached_active_user_cap")).toBe("rate_limit");
  });
  it("tells a photo TikTok could not take from a request it will never take", () => {
    expect(classifyTiktokError(200, "photo_pull_failed")).toBe("media");
    expect(classifyTiktokError(200, "picture_size_check_failed")).toBe("media");
    expect(classifyTiktokError(403, "url_ownership_unverified")).toBe("permanent");
    expect(classifyTiktokError(400, "invalid_param")).toBe("permanent");
    expect(classifyTiktokError(403, "unaudited_client_can_only_post_to_private_accounts")).toBe("permanent");
  });
  it("retries TikTok's own trouble", () => {
    expect(classifyTiktokError(500, "internal_error")).toBe("transient");
    expect(classifyTiktokError(502, null)).toBe("transient");
  });
});

describe("Login Kit", () => {
  it("sends the admin to TikTok's page with the three scopes and the state", () => {
    const u = new URL(tiktokAuthorizeUrl({ clientKey: "ck", redirectUri: "https://www.mazed.immo/api/admin/social/tiktok/callback", state: "s1" }));
    expect(u.origin + u.pathname).toBe("https://www.tiktok.com/v2/auth/authorize/");
    expect(u.searchParams.get("client_key")).toBe("ck");
    expect(u.searchParams.get("scope")).toBe("user.info.basic,video.publish,video.upload");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("redirect_uri")).toBe("https://www.mazed.immo/api/admin/social/tiktok/callback");
    expect(u.searchParams.get("state")).toBe("s1");
    expect(tiktokCallbackUrl("https://www.mazed.immo/")).toBe("https://www.mazed.immo/api/admin/social/tiktok/callback");
  });

  it("turns the code into both tokens, with their ends", async () => {
    const t = fakeTiktok({
      "POST /v2/oauth/token/": () => ({
        access_token: "act.1", expires_in: 7200, refresh_token: "rft.1", refresh_expires_in: 15_552_000,
        open_id: "open-1", scope: "user.info.basic,video.publish", token_type: "Bearer",
      }),
    });
    const now = Date.UTC(2026, 10, 15, 12);
    const got = await tiktokTokensFromCode({ clientKey: "ck", clientSecret: "cs", redirectUri: "https://x/cb", code: "c0de" }, t.fetch, now);
    expect(got).toEqual({
      accessToken: "act.1", accessExpiresAt: now + 7_200_000, refreshToken: "rft.1", refreshExpiresAt: now + 15_552_000_000,
      openId: "open-1", scopes: ["user.info.basic", "video.publish"],
    });
    const sent = new URLSearchParams(t.calls[0].body);
    expect(t.calls[0].headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(sent)).toEqual({ client_key: "ck", client_secret: "cs", code: "c0de", grant_type: "authorization_code", redirect_uri: "https://x/cb" });
  });

  it("refreshes with the refresh token and hands back the NEW one", async () => {
    const t = fakeTiktok({
      "POST /v2/oauth/token/": () => ({ access_token: "act.2", expires_in: 7200, refresh_token: "rft.2", refresh_expires_in: 100, open_id: "open-1", scope: "video.publish" }),
    });
    const got = await refreshTiktokTokens({ clientKey: "ck", clientSecret: "cs", refreshToken: "rft.1" }, t.fetch, 0);
    expect(got.refreshToken).toBe("rft.2");
    expect(new URLSearchParams(t.calls[0].body).get("grant_type")).toBe("refresh_token");
    expect(new URLSearchParams(t.calls[0].body).get("refresh_token")).toBe("rft.1");
  });

  it("reads a refused refresh as a lost connection", async () => {
    const t = fakeTiktok({
      "POST /v2/oauth/token/": () => ({ status: 400, json: { error: "invalid_grant", error_description: "Refresh token is invalid", log_id: "L" } }),
    });
    const err = await refreshTiktokTokens({ clientKey: "ck", clientSecret: "cs", refreshToken: "old" }, t.fetch).catch((e) => e);
    expect(err).toBeInstanceOf(TiktokError);
    expect(err.kind).toBe("auth");
    expect(err.tiktokCode).toBe("invalid_grant");
  });

  it("seals both tokens as one value no one can read", () => {
    const tokens = { accessToken: "act.1", accessExpiresAt: 1, refreshToken: "rft.1", refreshExpiresAt: 2, openId: "o", scopes: ["video.publish"] };
    const sealed = sealTiktokTokens(tokens, ENV);
    expect(sealed).not.toContain("act.1");
    expect(sealed).not.toContain("rft.1");
    expect(openTiktokTokens(sealed, ENV)).toEqual(tokens);
    expect(() => openTiktokTokens(sealed, { SOCIAL_TOKEN_KEY: randomBytes(32).toString("base64") })).toThrow();
  });

  it("says what is missing before « Connecter TikTok » works", () => {
    expect(missingTiktokConfig({})).toEqual(["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "SOCIAL_TOKEN_KEY"]);
    expect(missingTiktokConfig(ENV)).toEqual([]);
    expect(tiktokConfig({ TIKTOK_CLIENT_KEY: "ck" })).toBeNull();
    expect(tiktokConfig(ENV)).toEqual({ clientKey: "ck", clientSecret: "cs" });
  });

  it("takes @mazed613 only, whatever the case or the @", () => {
    expect(isWantedTiktok("Mazed613", "mazed613")).toBe(true);
    expect(isWantedTiktok("@mazed613", "@mazed613")).toBe(true);
    expect(isWantedTiktok("lassad.perso", "mazed613")).toBe(false);
    expect(isWantedTiktok(null, "mazed613")).toBe(false);
    expect(isWantedTiktok("anyone", "")).toBe(true);
  });
});

describe("Content Posting API", () => {
  it("asks who it posts as, with the bearer token", async () => {
    const t = fakeTiktok({
      "POST /v2/post/publish/creator_info/query/": () =>
        ok({ creator_username: "mazed613", creator_nickname: "Mazed Immo", privacy_level_options: ["SELF_ONLY"], comment_disabled: false }),
    });
    const info = await tiktokCreatorInfo(tiktokClient("act.1", { fetch: t.fetch }));
    expect(info).toEqual({ username: "mazed613", nickname: "Mazed Immo", privacyOptions: ["SELF_ONLY"], commentDisabled: false });
    expect(t.calls[0].headers.Authorization).toBe("Bearer act.1");
  });

  it("posts the photos by URL as a Photo Mode direct post", async () => {
    const t = fakeTiktok({ "POST /v2/post/publish/content/init/": () => ok({ publish_id: "p_pub_1" }) });
    const id = await initTiktokPhotoPost(tiktokClient("act", { fetch: t.fetch }), {
      title: "Titre",
      description: "Texte",
      imageUrls: ["https://www.mazed.immo/api/social/image/r/0?c=tiktok", "https://www.mazed.immo/api/social/image/r/1?c=tiktok"],
      draft: false,
      privacy: "SELF_ONLY",
      disableComment: true,
      autoAddMusic: true,
    });
    expect(id).toBe("p_pub_1");
    expect(JSON.parse(t.calls[0].body)).toEqual({
      post_info: {
        title: "Titre", description: "Texte", privacy_level: "SELF_ONLY", disable_comment: true, auto_add_music: true,
        brand_content_toggle: false, brand_organic_toggle: false,
      },
      source_info: {
        source: "PULL_FROM_URL",
        photo_cover_index: 0,
        photo_images: ["https://www.mazed.immo/api/social/image/r/0?c=tiktok", "https://www.mazed.immo/api/social/image/r/1?c=tiktok"],
      },
      post_mode: "DIRECT_POST",
      media_type: "PHOTO",
    });
  });

  it("sends a draft to the app's inbox without the direct post's choices", async () => {
    const t = fakeTiktok({ "POST /v2/post/publish/content/init/": () => ok({ publish_id: "p_pub_2" }) });
    await initTiktokPhotoPost(tiktokClient("act", { fetch: t.fetch }), { title: "T", description: "D", imageUrls: ["https://a/0"], draft: true });
    const body = JSON.parse(t.calls[0].body);
    expect(body.post_mode).toBe("MEDIA_UPLOAD");
    expect(body.post_info).toEqual({ title: "T", description: "D" });
  });

  it("refuses to start a post with no photo, and tells TikTok's audit refusal apart", async () => {
    const t = fakeTiktok({
      "POST /v2/post/publish/content/init/": () => ({
        status: 403,
        json: { error: { code: "unaudited_client_can_only_post_to_private_accounts", message: "Please review our integration guidelines", log_id: "L" } },
      }),
    });
    const c = tiktokClient("act", { fetch: t.fetch });
    const none = await initTiktokPhotoPost(c, { title: "T", description: "D", imageUrls: [], draft: true }).catch((e) => e);
    expect(none.kind).toBe("media");
    expect(t.calls).toHaveLength(0);
    const err = await initTiktokPhotoPost(c, { title: "T", description: "D", imageUrls: ["https://a/0"], draft: false, privacy: "SELF_ONLY" }).catch((e) => e);
    expect(isUnauditedRefusal(err)).toBe(true);
    expect(isUnauditedRefusal(new TiktokError("x", "permanent", "invalid_param"))).toBe(false);
  });

  it("keeps the 19-digit post ids whole", async () => {
    const raw = '{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[7436512345678901234]},"error":{"code":"ok","message":"","log_id":"L"}}';
    expect(parseKeepingIds(raw)).toEqual({
      data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: ["7436512345678901234"] },
      error: { code: "ok", message: "", log_id: "L" },
    });
    const t = fakeTiktok({ "POST /v2/post/publish/status/fetch/": () => ({ raw }) });
    const st = await tiktokPublishStatus(tiktokClient("act", { fetch: t.fetch }), "p1");
    expect(st).toEqual({ status: "PUBLISH_COMPLETE", failReason: null, postIds: ["7436512345678901234"] });
    expect(JSON.parse(t.calls[0].body)).toEqual({ publish_id: "p1" });
  });

  it("posts publicly only when asked and offered; otherwise « only me »", () => {
    expect(pickPrivacy(["PUBLIC_TO_EVERYONE", "SELF_ONLY"], true)).toBe("PUBLIC_TO_EVERYONE");
    expect(pickPrivacy(["PUBLIC_TO_EVERYONE", "SELF_ONLY"], false)).toBe("SELF_ONLY");
    expect(pickPrivacy(["SELF_ONLY"], true)).toBe("SELF_ONLY");
    expect(pickPrivacy(["FOLLOWER_OF_CREATOR"], false)).toBeNull();
  });

  it("links a public post, and has no link for a private one", () => {
    expect(tiktokPostUrl("mazed613", "7436512345678901234")).toBe("https://www.tiktok.com/@mazed613/photo/7436512345678901234");
    expect(tiktokPostUrl("mazed613", null)).toBeNull();
    expect(tiktokPostUrl(null, "1")).toBeNull();
  });
});

describe("the TikTok caption", () => {
  const house = socialListingFrom({
    id: "11111111-2222-3333-4444-555555555555",
    deal_type: "sale",
    price: 350000,
    price_on_request: false,
    governorate: "Sfax",
    delegation: "Route de Gremda",
    attributes: { area_sqm: 180, rooms: 3, titled: true },
    category: { slug: "maisons", label_fr: "Maisons", label_ar: "منازل" },
  });

  it("is built from the annonce's fields, with the short link for the bio and the hashtags", () => {
    const p = generatePost({ listing: house, channel: "tiktok", language: "fr", origin: "https://mazed.example", ref: "1a2b3c", today: "2026-11-15" });
    expect(p.body).toContain("🔗 Photos et détails : mazed.example/p/1A2B3C (lien dans la bio)");
    expect(p.body).toContain("Réf. MZ-1A2B3C");
    expect(p.body).not.toContain("utm_");
    expect(p.linkUrl).toContain("utm_source=tiktok");
    expect(p.hashtags).toEqual(expect.arrayContaining(["#MazedImmo", "#Sfax", "#AVendre", "#Maison", "#Tunisie"]));
  });

  it("makes the headline the title and the rest the description", () => {
    const p = generatePost({ listing: house, channel: "tiktok", language: "fr", origin: "https://mazed.example", ref: "1a2b3c", today: "2026-11-15" });
    const { title, description } = tiktokCaption(p.body);
    expect(title.replace(/ /g, " ")).toBe("🏠 À VENDRE · Maison S+3 · 180 m² · Route de Gremda, Sfax");
    expect(description.startsWith("💰")).toBe(true);
    expect(description).not.toContain("À VENDRE");
    expect(description).toContain("Réf. MZ-1A2B3C");
  });

  it("cuts a title too long for TikTok without breaking an emoji, and keeps the whole text below", () => {
    const head = `🏠 ${"Très belle villa ".repeat(8)}🌴`;
    const { title, description } = tiktokCaption(`${head}\n💰 1 DT`);
    expect(title.length).toBeLessThanOrEqual(90);
    expect(title.endsWith("…")).toBe(true);
    expect(title).not.toMatch(/[\uD800-\uDBFF]…$/);
    expect(description).toBe(`${head}\n💰 1 DT`);
    expect(tiktokCaption("\n\n")).toEqual({ title: "", description: "" });
  });
});

describe("TikTok among the channels", () => {
  it("is Mazed's to choose, not the seller's, and posted by the engine once connected", () => {
    expect(FEATURED_CHANNELS).toContain("tiktok");
    expect(OFFERED_CHANNELS).not.toContain("tiktok");
    expect(isApiChannel("tiktok")).toBe(true);
    expect(needsPhoto("tiktok")).toBe(true);
    expect(needsPhoto("facebook_mazed")).toBe(false);
  });

  it("is proposed beside « Mazed » when its switch is on, and never without a photo", () => {
    expect(autoQueueChannels({ mazed: true, page: false, instagram: false, tiktok: true })).toEqual(["facebook_mazed", "tiktok"]);
    expect(autoQueueChannels({ mazed: true, page: false, instagram: false })).toEqual(["facebook_mazed"]);
    expect(withPhotosOnly(["facebook_mazed", "tiktok"], 0)).toEqual(["facebook_mazed"]);
    expect(withPhotosOnly(["facebook_mazed", "tiktok"], 3)).toEqual(["facebook_mazed", "tiktok"]);
    expect(withPhotosOnly(["tiktok", "instagram"], 0)).toEqual([]);
  });
});
