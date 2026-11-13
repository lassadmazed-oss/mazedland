import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import type { Settings } from "@/lib/settings/registry";
import { parseRequestInput, requestExpiresAt, type RequestInput } from "./model";

/**
 * Saving a new demande (0168), shared by POST /api/requests (a signed-in
 * person) and POST /api/requests/guest (a visitor who has just confirmed their
 * number): the same validation, the same cap on live demandes, the same row.
 */

/** The body read as a demande, its categories kept only if they exist and are leaves. */
export async function readRequestBody(
  req: NextRequest,
  admin: SupabaseClient,
  body: Record<string, unknown>,
): Promise<{ ok: true; value: RequestInput } | { ok: false; response: NextResponse }> {
  const parsed = parseRequestInput(body);
  if (!parsed.ok) {
    const t = await apiTranslator(req, "requestsApi");
    return {
      ok: false,
      response: NextResponse.json(
        { error: parsed.error, detail: t(parsed.error === "budget_required" ? "budgetRequired" : "budgetOrder") },
        { status: 400 },
      ),
    };
  }
  const value = parsed.value;
  if (value.category_ids.length > 0) {
    const { data: cats } = await admin
      .from("categories")
      .select("id")
      .in("id", value.category_ids)
      .eq("is_active", true)
      .not("parent_id", "is", null);
    value.category_ids = (cats ?? []).map((c) => c.id as string);
  }
  return { ok: true, value };
}

/**
 * A new demande for `user`. A person keeps at most `requests_max_active` live
 * demandes: past that, alerts stop meaning "this is what I want". A new one
 * lives `requests_days`.
 */
export async function insertRequest(
  req: NextRequest,
  admin: SupabaseClient,
  user: { id: string; email?: string | null },
  value: RequestInput,
  settings: Settings,
  extra: Record<string, unknown> = {},
): Promise<NextResponse> {
  const { count } = await admin
    .from("property_requests")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString());
  if ((count ?? 0) >= settings.requests_max_active) {
    const t = await apiTranslator(req, "requestsApi");
    return NextResponse.json(
      { error: "too_many", detail: t("tooMany", { max: settings.requests_max_active }), ...extra },
      { status: 409 },
    );
  }
  const { data: created, error } = await admin
    .from("property_requests")
    // The table's own default is 60 days; the console's length wins.
    .insert({ ...value, user_id: user.id, expires_at: requestExpiresAt(settings.requests_days) })
    .select("id")
    .single();
  if (error || !created) return fail("request_create_failed", 500, error);
  logAction(req, user, "request.create", { id: created.id, deal: value.deal_type, ...("account" in extra ? { account: extra.account } : {}) });
  return NextResponse.json({ ok: true, id: created.id, ...extra });
}
