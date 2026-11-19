import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron/auth";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { fail } from "@/lib/http/errors";
import { runDaily } from "@/lib/prospection/daily";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/prospection-daily — once a day (07:05 UTC, 0219) with the
 * shared secret: a notice in the bell of each member of the Prospection team
 * who has something waiting (a follow-up that came due, a « oui » without
 * photos for a day, an SMS that never left), and the clean-up of old leads
 * (src/lib/prospection/daily.ts).
 */
export async function GET(req: NextRequest) {
  const denied = verifyCronSecret(req);
  if (denied) return denied;
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  try {
    return NextResponse.json({ ok: true, ...(await runDaily(admin)) });
  } catch (err) {
    return fail("prospection_daily_failed", 500, err);
  }
}

export const POST = GET;
