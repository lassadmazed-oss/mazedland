import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getAdminSession } from "@/lib/admin/session";
import { canOpen } from "@/lib/admin/sections";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { logAction } from "@/lib/activity";
import { log } from "@/lib/log";
import { socialSettings } from "@/lib/social/server";
import { tiktokClient, tiktokCreatorInfo, tiktokDisplayName, tiktokTokensFromCode, revokeTiktokToken } from "@/lib/social/tiktok";
import {
  isWantedTiktok, saveTiktokAccount, TIKTOK_COOKIE_PATH, TIKTOK_STATE_COOKIE, tiktokCallbackUrl, tiktokConfig,
} from "@/lib/social/tiktokConnect";

export const dynamic = "force-dynamic";

const sLog = log.scope("social");

/**
 * GET /api/admin/social/tiktok/callback?code=…&state=… — TikTok sends the
 * admin back here. The code becomes the account's tokens (sealed, never
 * shown); the account must be the one the social_tiktok_username setting
 * names (@mazedimmo), so a personal TikTok signed in by mistake is not taken.
 * Back to the console's accounts tab either way.
 */
export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(TIKTOK_STATE_COOKIE)?.value ?? "";
  const [expected, cookieLocale] = cookie.split(".");
  const locale = cookieLocale === "ar" ? "ar" : "fr";
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/${locale}/admin/social?tab=comptes&${q}`, req.nextUrl.origin));
    res.cookies.delete({ name: TIKTOK_STATE_COOKIE, path: TIKTOK_COOKIE_PATH });
    return res;
  };

  const { user, isAdmin, scopes } = await getAdminSession();
  if (!user || !isAdmin || !canOpen(scopes, "social")) return NextResponse.redirect(new URL(`/${locale}/login`, req.nextUrl.origin));

  const sp = req.nextUrl.searchParams;
  if (sp.get("error")) return back("tiktok_error=denied");
  const state = sp.get("state") ?? "";
  const code = sp.get("code") ?? "";
  const same =
    !!expected && state.length === expected.length && timingSafeEqual(Buffer.from(state), Buffer.from(expected));
  if (!same || !code) return back("tiktok_error=state");

  const config = tiktokConfig();
  const admin = getServiceSupabase();
  if (!config || !admin) return back("tiktok_error=not_configured");

  try {
    const tokens = await tiktokTokensFromCode({ ...config, redirectUri: tiktokCallbackUrl(req.nextUrl.origin), code });
    const c = tiktokClient(tokens.accessToken);
    // Who it is: creator_info needs Direct Post (video.publish); without it, the display name.
    const creator = await tiktokCreatorInfo(c).catch(async () => ({
      username: null,
      nickname: await tiktokDisplayName(c).catch(() => null),
      privacyOptions: [],
      commentDisabled: false,
    }));
    const { tiktok } = await socialSettings(admin);
    if (!isWantedTiktok(creator.username, tiktok.username)) {
      // Not Mazed Immo's account: nothing is kept, and TikTok forgets the grant.
      await revokeTiktokToken({ ...config, token: tokens.accessToken });
      const detail = `compte : ${creator.username ? `@${creator.username}` : (creator.nickname ?? "?")} · attendu : @${tiktok.username}`;
      sLog.warn("tiktok connect: not the expected account", { detail });
      return back(`tiktok_error=other_account&d=${encodeURIComponent(detail)}`);
    }
    await saveTiktokAccount(admin, { tokens, creator, adminId: user.id });
    logAction(req, user, "social.account_connect", { platform: "tiktok", username: creator.username });
    return back("tiktok_connected=1");
  } catch (err) {
    sLog.warn("tiktok connect failed", { msg: err instanceof Error ? err.message : String(err) });
    return back("tiktok_error=failed");
  }
}
