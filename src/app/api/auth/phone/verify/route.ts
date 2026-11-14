import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { clientIp } from "@/lib/clientIp";
import { PHONE_PROOF_COOKIE, PHONE_PROOF_TTL_MS, hashCode, signPhoneProof } from "@/lib/otp";
import { OTP_MAX_ATTEMPTS } from "@/lib/otpPolicy";

/**
 * POST /api/auth/phone/verify — check a phone OTP.
 *
 * Body: { phone: "+216…", code: "123456" }
 * 200 { ok:true } on success (code is single-use — its hash is emptied).
 * 400 on wrong/expired/missing code; 429 after too many attempts.
 *
 * The guess is judged by ONE locked function (otp_check, 0227): the row is held
 * while its attempts are read and counted, so « 5 wrong guesses per code » is 5
 * even when fifty requests arrive together. It used to read `attempts`, compare,
 * then write attempts + 1 — and parallel guesses all read 0.
 *
 * Constant set of error codes so it doesn't leak whether the number exists.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const ip = clientIp(req);

  let phone = "";
  let code = "";
  try {
    const body = (await req.json()) as { phone?: unknown; code?: unknown };
    if (typeof body.phone === "string") phone = body.phone.trim();
    if (typeof body.code === "string") code = body.code.replace(/\D/g, "");
  } catch {
    /* fall through to 400 */
  }
  if (!/^\+\d{8,15}$/.test(phone) || code.length !== 6) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const admin = getServiceSupabase();
  if (!admin) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  // Per-IP throttle (cross-instance): the per-number attempt cap below does not
  // stop an attacker brute-forcing codes across many numbers from one IP.
  const { data: ipBlocked } = await admin.rpc("check_auth_ratelimit", { p_ip: ip });
  if (ipBlocked === true) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const { data: verdict, error } = await admin.rpc("otp_check", {
    p_phone: phone,
    p_hash: hashCode(phone, code),
    p_max_attempts: OTP_MAX_ATTEMPTS,
  });
  if (error || typeof verdict !== "string") {
    return NextResponse.json({ error: "verify_failed" }, { status: 500 });
  }
  if (verdict === "no_code") return NextResponse.json({ error: "no_code" }, { status: 400 });
  if (verdict === "expired") return NextResponse.json({ error: "expired" }, { status: 400 });
  if (verdict === "too_many") return NextResponse.json({ error: "too_many_attempts" }, { status: 429 });
  if (verdict === "wrong") return NextResponse.json({ error: "wrong_code" }, { status: 400 });

  // Correct — otp_check stamped verified_at (the proof the signup route checks:
  // signup must fail closed when SMS is on) and emptied the hash so the code
  // can't be re-verified. The signup route deletes the row once it consumes the
  // proof; a fresh /phone/send writes a new code and nulls the stamp.
  //
  // The row says this number was verified; the cookie says THIS browser did it.
  // Signup and password reset require both — see signPhoneProof.
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: PHONE_PROOF_COOKIE,
    value: signPhoneProof(phone, Date.now() + PHONE_PROOF_TTL_MS),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(PHONE_PROOF_TTL_MS / 1000),
  });
  return res;
}
