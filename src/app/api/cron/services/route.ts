import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron/auth";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { runServicesWatch, sendDatabaseDownSms } from "@/lib/services/run";
import { supabaseAnswers } from "@/lib/services/providers";
import { fail } from "@/lib/http/errors";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
// Five providers at ten seconds each, in parallel, and a few SMS.
export const maxDuration = 60;

const cLog = log.scope("cron-services");

/**
 * The paid services' hourly watch (0203, /admin/abonnements): each provider
 * read, every due SMS sent (src/lib/services/run.ts).
 *
 * Scheduled by Vercel (vercel.json), not pg_cron like the other drains, on
 * purpose: it is the one that tells the owner the database is down, so it
 * must not depend on the database to start. The database watches it back —
 * services_watchdog (0203) texts the owner when this stops stamping its
 * heartbeat, or when the site answers 402.
 *
 * Auth: CRON_SECRET as a Bearer header, which Vercel's cron sends.
 */
async function run(req: NextRequest) {
  const denied = verifyCronSecret(req);
  if (denied) return denied;
  const db = getServiceSupabase();
  if (!db) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });

  try {
    const report = await runServicesWatch(db, { send: true });
    return NextResponse.json({ ok: true, ...report });
  } catch (e) {
    // A query that failed while Supabase itself answers is a bug for the
    // logs; Supabase not answering is what the owner must hear about.
    if (!(await supabaseAnswers())) {
      const sent = await sendDatabaseDownSms();
      cLog.error("database unreachable", { sent });
      return NextResponse.json({ ok: false, error: "database_unreachable", sent }, { status: 503 });
    }
    return fail("services_watch_failed", 500, e);
  }
}

export const GET = run;
export const POST = run;
