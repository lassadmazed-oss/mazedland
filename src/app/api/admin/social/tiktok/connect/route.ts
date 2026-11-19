import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getAdminSession } from "@/lib/admin/session";
import { canOpen } from "@/lib/admin/sections";
import { requestLocale } from "@/lib/i18n/server";
import { TIKTOK_COOKIE_PATH, TIKTOK_STATE_COOKIE, tiktokCallbackUrl, tiktokConfig } from "@/lib/social/tiktokConnect";
import { tiktokAuthorizeUrl } from "@/lib/social/tiktok";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/social/tiktok/connect — send an admin to TikTok to connect
 * Mazed Immo's account (@mazed613). A link the admin clicks, as Facebook's
 * is; the one-time `state` in a cookie ties TikTok's answer to this click.
 */
export async function GET(req: NextRequest) {
  const locale = requestLocale(req);
  const { user, isAdmin, scopes } = await getAdminSession();
  if (!user || !isAdmin || !canOpen(scopes, "social")) return NextResponse.redirect(new URL(`/${locale}/login`, req.nextUrl.origin));

  const config = tiktokConfig();
  if (!config) {
    return NextResponse.redirect(new URL(`/${locale}/admin/social?tab=comptes&tiktok_error=not_configured`, req.nextUrl.origin));
  }
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(
    tiktokAuthorizeUrl({ clientKey: config.clientKey, redirectUri: tiktokCallbackUrl(req.nextUrl.origin), state }),
  );
  res.cookies.set(TIKTOK_STATE_COOKIE, `${state}.${locale}`, {
    httpOnly: true,
    secure: req.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: TIKTOK_COOKIE_PATH,
    maxAge: 600,
  });
  return res;
}
