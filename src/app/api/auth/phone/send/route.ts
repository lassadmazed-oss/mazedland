import { NextRequest, NextResponse } from "next/server";
import { randomInt } from "crypto";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { clientIp } from "@/lib/clientIp";
import { sendSms, isSmsConfigured, needsUnicode } from "@/lib/winsms";
import { smsIsDown } from "@/lib/sms/gate";
import { apiTranslator } from "@/lib/i18n/server";
import { PHONE_PROOF_COOKIE, hashCode } from "@/lib/otp";
import {
  OTP_COOLDOWN_SECS,
  OTP_GLOBAL_KEY,
  OTP_MAX_PER_WINDOW,
  OTP_TTL_SECS,
  OTP_WINDOW_SECS,
  dialCodeAllowed,
} from "@/lib/otpPolicy";
import { recentHits, recordHit } from "@/lib/rateLimitCount";
import { getSettings } from "@/lib/settings/server";
import { logError } from "@/lib/activity";
import { log } from "@/lib/log";

const oLog = log.scope("otp-send");

/**
 * POST /api/auth/phone/send — issue a 6-digit SMS verification code via WinSMS.
 *
 * Env-gated: if WinSMS isn't configured, returns { ok:true, configured:false }
 * so the signup flow can skip verification and keep working until the key lands.
 *
 * Codes are stored hashed in phone_otps (serverless-safe). Limits, none of them
 * a read-then-write across two requests (0227, security audit 2026-11-14):
 *   · a dial code the forms offer (`otp_dial_codes`), not any number on earth;
 *   · per address: check_auth_ratelimit;
 *   · per number: 60 s cooldown + 5 an hour, decided and stored in ONE locked
 *     function (otp_issue), so a burst of parallel requests sends one SMS;
 *   · for the whole site: `otp_daily_cap` codes a day — the ceiling on what a
 *     script rotating numbers and addresses can spend. Reaching it tells the admins.
 * Responses don't reveal whether a number is already registered.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // CSRF: only our own origin may trigger SMS (each send costs real operator
  // money and spams a real phone).
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const ip = clientIp(req);

  // SMS off → tell the client to proceed without verification.
  if (!isSmsConfigured()) {
    return NextResponse.json({ ok: true, configured: false });
  }

  let phone = "";
  try {
    const body = (await req.json()) as { phone?: unknown };
    if (typeof body.phone === "string") phone = body.phone.trim();
  } catch {
    /* phone stays empty → 400 below */
  }
  if (!/^\+\d{8,15}$/.test(phone)) {
    return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
  }
  const settings = await getSettings();
  if (!dialCodeAllowed(phone, settings.otp_dial_codes)) {
    return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
  }

  const admin = getServiceSupabase();
  if (!admin) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  // WinSMS is known to be failing (sms_health, 0224): say so now, before a code is stored and the
  // person's cooldown spent on a message that would never arrive. The forms show « SMS could not be sent ».
  if (await smsIsDown()) return NextResponse.json({ error: "sms_unavailable" }, { status: 503 });

  // Per-IP throttle (cross-instance, DB-backed). The per-NUMBER cooldown below
  // does not stop an attacker iterating MANY numbers from one IP to burn SMS
  // credit / spam arbitrary phones — this does.
  const { data: ipBlocked } = await admin.rpc("check_auth_ratelimit", { p_ip: ip });
  if (ipBlocked === true) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  // The day's budget of codes for the whole site. Read here, spent below once a
  // code is really issued: a request the cooldown refuses costs nothing, or a
  // script could empty the budget with refused requests and close signups.
  if ((await recentHits(admin, OTP_GLOBAL_KEY, 86_400)) >= settings.otp_daily_cap) {
    // One alert per six hours (0185): the admins hear that codes stopped.
    logError({
      action: "otp.daily_cap",
      path: "/api/auth/phone/send",
      metadata: { route: "/api/auth/phone/send", message: `otp_daily_cap_reached (${settings.otp_daily_cap}/day)` },
    });
    return NextResponse.json({ error: "sms_unavailable" }, { status: 503 });
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");

  // The cooldown, the hourly cap and the write in one locked step. A new code
  // retires the previous verification: without that, the proof left by a
  // finished signup stayed usable for the rest of its 15 minutes.
  const { data: issued, error: issueErr } = await admin.rpc("otp_issue", {
    p_phone: phone,
    p_hash: hashCode(phone, code),
    p_ttl_secs: OTP_TTL_SECS,
    p_cooldown_secs: OTP_COOLDOWN_SECS,
    p_window_secs: OTP_WINDOW_SECS,
    p_max: OTP_MAX_PER_WINDOW,
  });
  if (issueErr || !issued) {
    oLog.error(`store failed: ${issueErr?.message ?? "no answer"}`);
    return NextResponse.json({ error: "store_failed" }, { status: 500 });
  }
  const verdict = issued as { status: string; retry_after?: number };
  if (verdict.status === "cooldown") {
    return NextResponse.json({ error: "cooldown", retryAfter: verdict.retry_after ?? OTP_COOLDOWN_SECS }, { status: 429 });
  }
  if (verdict.status === "too_many") {
    return NextResponse.json({ error: "too_many" }, { status: 429 });
  }
  await recordHit(admin, OTP_GLOBAL_KEY, 86_400);

  // In the language of the page that asked for it (signup / forgot-password).
  const t = await apiTranslator(req, "sms");
  const message = t("otp", { code });
  const sent = await sendSms({ to: phone, sms: message, unicode: needsUnicode(message) });
  if (!sent.ok) {
    return NextResponse.json({ error: "send_failed" }, { status: 502 });
  }

  // The browser's old proof goes with it: the new code has to be verified.
  const res = NextResponse.json({ ok: true, configured: true });
  res.cookies.delete(PHONE_PROOF_COOKIE);
  return res;
}
