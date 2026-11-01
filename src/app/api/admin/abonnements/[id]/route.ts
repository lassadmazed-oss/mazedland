import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { audit } from "@/lib/admin/audit";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { parseServiceInput } from "@/lib/services/input";
import { nextRenewal, type PaidService } from "@/lib/services/services";

/**
 * One paid service.
 *
 *   PATCH  → change it. Only the fields sent are touched. `{ renewed: true }`
 *            is « Payé, cycle suivant »: the date moves a month or a year on,
 *            so the reminders start over for the next one.
 *   DELETE → remove it, with its SMS log (cascade). For a row entered by
 *            mistake; one that stopped being paid is « Suivi arrêté ».
 */
type Ctx = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const gate = await requireAdmin(req, "abonnements");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const { data: before } = await admin.from("paid_services").select("*").eq("id", id).maybeSingle();
  if (!before) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const row = before as PaidService;

  let patch: Record<string, unknown>;
  if (body.renewed === true) {
    const next = row.renews_on ? nextRenewal(row.renews_on, row.cycle) : null;
    if (!next) return NextResponse.json({ error: "invalid" }, { status: 400 });
    patch = { renews_on: next };
  } else {
    const parsed = parseServiceInput(body, { partial: true });
    if (!parsed.ok) {
      const t = await apiTranslator(req, "adminServices.api");
      return NextResponse.json({ error: "invalid", field: parsed.error, detail: t(parsed.error) }, { status: 400 });
    }
    patch = parsed.value;
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true, updated: 0 });

  const { error } = await admin.from("paid_services").update(patch).eq("id", id);
  if (error) {
    if (error.code === "23514") return NextResponse.json({ error: "invalid" }, { status: 400 });
    return fail("service_update_failed", 500, error);
  }

  const beforeFields = Object.fromEntries(Object.keys(patch).map((k) => [k, row[k as keyof PaidService]]));
  await audit(admin, user.id, {
    action: body.renewed === true ? "service.renewed" : "service.update",
    targetType: "paid_service",
    targetId: id,
    before: beforeFields,
    after: patch,
  });
  return NextResponse.json({ ok: true, renews_on: patch.renews_on ?? row.renews_on });
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const gate = await requireAdmin(req, "abonnements");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const { data, error } = await admin.from("paid_services").delete().eq("id", id).select("name, provider").maybeSingle();
  if (error) return fail("service_delete_failed", 500, error);
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await audit(admin, user.id, { action: "service.delete", targetType: "paid_service", targetId: id, before: data });
  return NextResponse.json({ ok: true });
}
