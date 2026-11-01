import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { audit } from "@/lib/admin/audit";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { parseServiceInput } from "@/lib/services/input";

/**
 * The site's paid services (0203), for /admin/abonnements.
 *
 *   POST → add one. Its date is the admin's until a provider reports one.
 *
 * Owner-only (OWNER_SECTIONS), through the service role: `paid_services` is
 * closed to every client role.
 */
export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, "abonnements");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const parsed = parseServiceInput(body, { partial: false });
  if (!parsed.ok) {
    const t = await apiTranslator(req, "adminServices.api");
    return NextResponse.json({ error: "invalid", field: parsed.error, detail: t(parsed.error) }, { status: 400 });
  }

  const { data, error } = await admin
    .from("paid_services")
    .insert({ ...parsed.value, created_by: user.id, sort_order: 100 })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23514") return NextResponse.json({ error: "invalid" }, { status: 400 });
    return fail("service_create_failed", 500, error);
  }

  await audit(admin, user.id, { action: "service.create", targetType: "paid_service", targetId: data.id, after: parsed.value });
  return NextResponse.json({ ok: true, id: data.id });
}
