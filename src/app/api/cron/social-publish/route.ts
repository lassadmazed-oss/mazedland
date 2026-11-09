import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron/auth";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { fail } from "@/lib/http/errors";
import { runDueSocialJobs } from "@/lib/social/engine";
import { queueFeaturedListings } from "@/lib/social/autoqueue";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
// An Instagram carousel is a dozen calls and a few seconds of waiting for the
// container; five jobs fit well inside a minute.
export const maxDuration = 60;

/**
 * The Social Publisher's worker (0170): every five minutes pg_cron calls
 * this with the shared secret, and it does the jobs that are due — posts,
 * retries, « vendu / loué » follow-ups. Jobs are claimed with SKIP LOCKED,
 * so two runs at once never take the same one.
 *
 * First it proposes the annonces that went online since the last run to the
 * owner (queueFeaturedListings): asks waiting in « À valider », nothing posted.
 * That is a courtesy to the console and never holds the jobs back.
 */
export async function GET(req: NextRequest) {
  const denied = verifyCronSecret(req);
  if (denied) return denied;
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  const proposed = await queueFeaturedListings(admin, { origin: req.nextUrl.origin }).catch((err) => {
    log.scope("social-auto-queue").error(`failed: ${err instanceof Error ? err.message : String(err)}`);
    return { queued: 0, failed: true as const };
  });
  try {
    const result = await runDueSocialJobs(admin, { limit: 5, origin: req.nextUrl.origin });
    return NextResponse.json({ ok: true, ...result, proposed });
  } catch (err) {
    return fail("social_publish_failed", 500, err);
  }
}
