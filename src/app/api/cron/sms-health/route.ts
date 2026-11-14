import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron/auth";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { fail } from "@/lib/http/errors";
import { runSmsHealth } from "@/lib/sms/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The provider's outbox is a big list that takes seconds to come, twice when it is probed.
export const maxDuration = 120;

/**
 * GET /api/cron/sms-health — every ten minutes (0224) with the shared secret:
 * reads WinSMS's outbox, keeps the verdict « is the provider delivering? » that
 * sendSms obeys, tells the admins when it changes, and sends again what failed
 * once WinSMS answers (src/lib/sms/health.ts).
 */
export async function GET(req: NextRequest) {
  const denied = verifyCronSecret(req);
  if (denied) return denied;
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  try {
    return NextResponse.json({ ok: true, ...(await runSmsHealth(admin)) });
  } catch (err) {
    return fail("sms_health_failed", 500, err);
  }
}

export const POST = GET;
