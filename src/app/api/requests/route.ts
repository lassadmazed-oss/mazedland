import { NextRequest, NextResponse } from "next/server";
import { jsonObject } from "@/lib/http/body";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { insertRequest, readRequestBody } from "@/lib/requests/create";
import { featureOff } from "@/lib/settings/gate";
import { getSettings } from "@/lib/settings/server";

/**
 * POST /api/requests — create or update a demande (0168).
 *
 *   { id?, deal_type, category_ids[], governorates[], budget_min?, budget_max,
 *     surface_min?, rooms_min?, furnished?, move_in_by?, note?, alerts? }
 *
 * The owner is always the caller. Categories are kept only if they exist and
 * are leaves, like an annonce's. A person keeps at most `requests_max_active`
 * live demandes: past that, alerts stop meaning "this is what I want". A new
 * one lives `requests_days` (src/lib/requests/create.ts, shared with the
 * visitor's route, /api/requests/guest). Switched off, nothing is created or
 * edited; the demandes already there can still be paused or deleted
 * (/api/requests/:id).
 */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const off = await featureOff("feature_requests");
  if (off) return off;
  const settings = await getSettings();
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const body = await jsonObject(req);
  const read = await readRequestBody(req, admin, body);
  if (!read.ok) return read.response;
  const value = read.value;

  const id = typeof body.id === "string" ? body.id : null;
  if (id) {
    const { data: own } = await admin
      .from("property_requests")
      .select("id, user_id")
      .eq("id", id)
      .maybeSingle();
    if (!own || own.user_id !== user.id) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const { error } = await admin.from("property_requests").update(value).eq("id", id);
    if (error) return fail("request_update_failed", 500, error);
    logAction(req, user, "request.update", { id });
    return NextResponse.json({ ok: true, id });
  }

  return insertRequest(req, admin, user, value, settings);
}
