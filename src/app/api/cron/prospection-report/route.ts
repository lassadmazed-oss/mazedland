import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron/auth";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { fail } from "@/lib/http/errors";
import { runReport } from "@/lib/prospection/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/prospection-report — every hour of the evening (0223) with the
 * shared secret: from the hour set in Réglages, one notice in the bell of each
 * admin who holds the whole console, with what each member of the Prospection
 * team did that day (src/lib/prospection/report.ts). It sends once a day, so the
 * later runs find it done.
 */
export async function GET(req: NextRequest) {
  const denied = verifyCronSecret(req);
  if (denied) return denied;
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  try {
    return NextResponse.json({ ok: true, ...(await runReport(admin)) });
  } catch (err) {
    return fail("prospection_report_failed", 500, err);
  }
}

export const POST = GET;
