import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { audit } from "@/lib/admin/audit";
import { fail } from "@/lib/http/errors";
import { isSmsConfigured } from "@/lib/winsms";
import { sendTestSms } from "@/lib/services/run";

/**
 * « Envoyer un SMS de test » to the alert numbers of /admin/abonnements, now.
 * Three an hour: each one is a real SMS on the WinSMS credit.
 */
export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, "abonnements");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  if (!isSmsConfigured()) return NextResponse.json({ error: "sms_not_configured" }, { status: 503 });

  const { data: over } = await admin.rpc("check_rate_limit", {
    p_key: `services:test-sms:${user.id}`,
    p_max: 3,
    p_window_secs: 3600,
  });
  if (over === true) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const result = await sendTestSms(admin);
  await audit(admin, user.id, { action: "service.test_sms", targetType: "paid_service", after: result });
  if (result.phones === 0) return NextResponse.json({ error: "no_recipients" }, { status: 400 });
  return NextResponse.json({ ok: result.failed === 0, ...result }, { status: result.sent > 0 ? 200 : 502 });
}
