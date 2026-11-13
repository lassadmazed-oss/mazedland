import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { jsonObject } from "@/lib/http/body";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { clientIp } from "@/lib/clientIp";
import { fail } from "@/lib/http/errors";
import { isSmsConfigured } from "@/lib/winsms";
import { PHONE_PROOF_COOKIE, verifyPhoneProof } from "@/lib/otp";
import { requestLocale } from "@/lib/i18n/server";
import { featureOff } from "@/lib/settings/gate";
import { getSettings } from "@/lib/settings/server";
import { recordConsents } from "@/lib/consents/server";
import { recordServerEvent } from "@/lib/analytics/server-events";
import { phoneEmail } from "@/lib/auth/phoneEmail";
import { insertRequest, readRequestBody } from "@/lib/requests/create";
import { suspendedResponse } from "@/lib/moderation/ban";

/** How long after /api/auth/phone/verify the proof is good for — the signup's window. */
const VERIFY_WINDOW_MS = 15 * 60 * 1000;

/**
 * POST /api/requests/guest — a visitor's demande (2026-11-10, the owner: the
 * form first, the number at the end, not a login page before it).
 *
 *   { phone: "+216…", accepted: true, ...the demande as POST /api/requests }
 *
 * The visitor fills the demande signed out, then proves the number through
 * /api/auth/phone/send + /verify — the pair the signup and the password reset
 * already rest on: the `phone_otps` row says the number was verified in the
 * last fifteen minutes, the HttpOnly cookie says THIS browser verified it.
 *
 *   - No account for the number: one is made, as /api/auth/signup makes it
 *     (the synthetic address, the CGU answer recorded) but with no password
 *     typed — a random one nobody sees; « Mot de passe oublié » sets one by
 *     SMS. The visitor is signed in and the demande saved.  → account: "new"
 *   - An account already holds it: the demande is saved there and NOBODY is
 *     signed in. The code proves the number, not the right to open an
 *     account someone made; that stays the login page's job.  → account: "existing"
 *   - Already signed in (a second try after a failure past the sign-in): the
 *     plain route's path, no number needed.  → account: "signed_in"
 *
 * The proof is spent only when the demande is saved, so a refusal (too many
 * live demandes, a server error) can be retried without a new SMS.
 * Off with `requests_guest_form` or without SMS: the form sends to login
 * first, as before (src/app/[locale]/demandes/nouvelle/page.tsx).
 */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const off = await featureOff("feature_requests");
  if (off) return off;
  const settings = await getSettings();
  if (!settings.requests_guest_form) return NextResponse.json({ error: "guest_off" }, { status: 403 });

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  // The demande first: a refused one makes no account.
  const body = await jsonObject(req);
  const read = await readRequestBody(req, admin, body);
  if (!read.ok) return read.response;
  const value = read.value;

  const supabase = await getServerSupabase();
  const { data: { user: current } } = await supabase.auth.getUser();
  if (current) return insertRequest(req, admin, current, value, settings, { account: "signed_in", signedIn: true });

  // Without SMS there is no number to prove.
  if (!isSmsConfigured()) return NextResponse.json({ error: "sms_not_configured" }, { status: 503 });

  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  if (!/^\+\d{8,15}$/.test(phone)) return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
  if (body.accepted !== true) return NextResponse.json({ error: "terms_required" }, { status: 400 });

  // Cross-instance, per IP — the same throttle as the signup and the reset.
  const { data: blocked } = await admin.rpc("check_auth_ratelimit", { p_ip: clientIp(req) });
  if (blocked === true) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  if (!verifyPhoneProof(req.cookies.get(PHONE_PROOF_COOKIE)?.value, phone)) {
    return NextResponse.json({ error: "phone_not_verified" }, { status: 403 });
  }
  const { data: otp } = await admin.from("phone_otps").select("verified_at").eq("phone", phone).maybeSingle();
  const verifiedMs = otp?.verified_at ? new Date(otp.verified_at as string).getTime() : 0;
  if (!verifiedMs || Date.now() - verifiedMs > VERIFY_WINDOW_MS) {
    return NextResponse.json({ error: "phone_not_verified" }, { status: 403 });
  }

  /** Spends the proof once the demande is in, so it opens nothing else. */
  const spend = async (res: NextResponse): Promise<NextResponse> => {
    if (res.ok) {
      await admin.from("phone_otps").delete().eq("phone", phone);
      res.cookies.delete(PHONE_PROOF_COOKIE);
    }
    return res;
  };

  // Asked after the proof, like the signup's « phone_taken »: before it, the
  // answer would tell anyone which numbers have an account.
  const { data: profile } = await admin.from("profiles").select("id").eq("phone", phone).maybeSingle();
  if (profile?.id) {
    // A suspended account cannot sign in; its number must not keep feeding it
    // demandes the agences would answer.
    const banned = await suspendedResponse(admin, req, profile.id as string);
    if (banned) return banned;
    return spend(await insertRequest(req, admin, { id: profile.id as string }, value, settings, { account: "existing", signedIn: false }));
  }

  const email = phoneEmail(phone);
  const password = randomBytes(24).toString("base64url");
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: null,
      phone,
      // Where they look first stands for where they live until they say.
      governorate: value.governorates[0] ?? null,
      language: requestLocale(req),
    },
  });
  if (createErr || !created.user) {
    // The synthetic address is taken with no profile on the number: an older
    // account. Not ours to open — the login page is.
    const msg = createErr?.message?.toLowerCase() ?? "";
    if (msg.includes("already") || msg.includes("registered") || msg.includes("exist")) {
      return NextResponse.json({ error: "phone_taken" }, { status: 409 });
    }
    return fail("signup_failed", 500, createErr ?? undefined);
  }
  await recordConsents(
    admin,
    created.user.id,
    [{ kind: "terms", granted: true }, { kind: "privacy", granted: true }],
    settings.legal_version,
    "signup",
  );
  recordServerEvent(req, "sign_up", { userId: created.user.id, params: { method: "demande" } });

  // Signed in on the SSR client: the auth cookie goes out on this response,
  // as on the signup's. Failing that, the demande is still saved and the
  // account is there for « Mot de passe oublié ».
  const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
  return spend(await insertRequest(req, admin, created.user, value, settings, { account: "new", signedIn: !signInErr }));
}
