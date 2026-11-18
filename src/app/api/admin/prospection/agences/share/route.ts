import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { featureOff } from "@/lib/settings/gate";
import { fail } from "@/lib/http/errors";
import { jsonObject } from "@/lib/http/body";
import { logAction } from "@/lib/activity";
import { audit } from "@/lib/admin/audit";
import { shareOutUnassigned } from "@/lib/prospection/agencies/server";
import { teamNames } from "@/lib/prospection/report";

/**
 * POST /api/admin/prospection/agences/share  { member_ids: string[] }
 *
 * The agencies nobody holds, shared among the chosen members of the team in
 * equal parts and by governorate. The whole console only. Only members of the
 * team (admins given « Prospection ») can be chosen.
 */
export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, "prospection");
  if (gate instanceof NextResponse) return gate;
  if (gate.scopes !== null) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const off = await featureOff("feature_prospection");
  if (off) return off;
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const body = await jsonObject(req);
  const asked = Array.isArray(body.member_ids) ? body.member_ids.filter((x): x is string => typeof x === "string") : [];
  const team = await teamNames(admin);
  const members = [...new Set(asked)].filter((id) => team.has(id));
  if (members.length === 0) return NextResponse.json({ error: "no_members" }, { status: 400 });

  const counts = await shareOutUnassigned(admin, members, gate.user.id);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  logAction(req, gate.user, "prospect.agency.share", { members: members.length, total });
  await audit(admin, gate.user.id, { action: "prospect.agency.share", targetType: "prospect_agencies", targetId: null, note: `${total} shared among ${members.length}` });
  return NextResponse.json({ ok: true, counts: Object.fromEntries(Object.entries(counts).map(([id, n]) => [team.get(id) ?? id, n])), total });
}
