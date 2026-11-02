import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import { getSettings } from "@/lib/settings/server";
import { ga4Status } from "@/lib/analytics/queries";
import { testGa4 } from "@/lib/analytics/ga4-data";

/**
 * POST /api/admin/analytics/ga4-test — one small Google report, to say
 * whether the service account and the property ID work together. The key
 * never leaves the server; the answer is a count or Google's words.
 */
export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, "analytics");
  if (gate instanceof NextResponse) return gate;
  const settings = await getSettings();
  const status = ga4Status(settings.analytics_ga_property_id);
  if (status.state !== "ready") return NextResponse.json({ ok: false, error: status.state }, { status: 400 });
  const result = await testGa4(status.propertyId, status.account);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
