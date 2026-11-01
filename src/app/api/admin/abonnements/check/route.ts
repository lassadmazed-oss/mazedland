import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { fail } from "@/lib/http/errors";
import { runServicesWatch } from "@/lib/services/run";

export const maxDuration = 60;

/**
 * « Vérifier maintenant »: the hourly watch, run at once — each provider
 * asked, and what is due sent (an SMS already sent is not sent again; the
 * alert log decides that, not this button). A few a minute at most: each run
 * calls five providers.
 */
export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, "abonnements");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const { data: over } = await admin.rpc("check_rate_limit", {
    p_key: `services:check:${user.id}`,
    p_max: 6,
    p_window_secs: 600,
  });
  if (over === true) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  try {
    const report = await runServicesWatch(admin, { send: true });
    return NextResponse.json({ ok: true, ...report });
  } catch (e) {
    return fail("services_watch_failed", 500, e);
  }
}
