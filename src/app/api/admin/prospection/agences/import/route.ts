import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { featureOff } from "@/lib/settings/gate";
import { fail } from "@/lib/http/errors";
import { jsonObject } from "@/lib/http/body";
import { logAction } from "@/lib/activity";
import { audit } from "@/lib/admin/audit";
import { importAgencies } from "@/lib/prospection/agencies/server";
import { isAgencySource, readAgencyCsv } from "@/lib/prospection/agencies/model";

const MAX_CSV = 1_500_000;

/**
 * POST /api/admin/prospection/agences/import  { csv, source?, source_note?, assign_to?, dry_run? }
 *
 * A list of agencies (a CSV, or a copy pasted from a sheet) becomes rows of the
 * list. `dry_run: true` says what it would do without adding anything: how many
 * are new, which numbers are already on the list, which are on the « ne pas
 * contacter » list, which lines could not be read and why. The whole console
 * only: a member works the agencies they are given.
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
  const csv = typeof body.csv === "string" ? body.csv : "";
  if (!csv.trim()) return NextResponse.json({ error: "empty" }, { status: 400 });
  if (csv.length > MAX_CSV) return NextResponse.json({ error: "too_big" }, { status: 413 });

  const read = readAgencyCsv(csv);
  if (!read.columns.includes("name")) return NextResponse.json({ error: "no_name_column", columns: read.columns }, { status: 400 });
  if (read.rows.length === 0 && read.problems.length === 0) return NextResponse.json({ error: "empty" }, { status: 400 });

  const source = isAgencySource(body.source) ? body.source : "csv";
  const sourceNote = typeof body.source_note === "string" && body.source_note.trim() ? body.source_note.trim().slice(0, 200) : null;
  const assignTo = typeof body.assign_to === "string" && body.assign_to ? body.assign_to : null;
  const dryRun = body.dry_run !== false;

  const { plan, inserted } = await importAgencies(admin, { rows: read.rows, source, sourceNote, actorId: gate.user.id, assignTo, dryRun });

  if (!dryRun) {
    logAction(req, gate.user, "prospect.agency.import", { rows: read.rows.length, inserted });
    await audit(admin, gate.user.id, { action: "prospect.agency.import", targetType: "prospect_agencies", targetId: null, note: `${inserted} added · ${plan.duplicates.length} duplicates · ${plan.doNotContact.length} refused · ${sourceNote ?? source}` });
  }
  return NextResponse.json({
    ok: true,
    dryRun,
    columns: read.columns,
    read: read.rows.length,
    problems: read.problems.slice(0, 50),
    problemCount: read.problems.length,
    toAdd: plan.insert.length,
    withoutNumber: plan.withoutNumber,
    duplicates: plan.duplicates.slice(0, 30),
    duplicateCount: plan.duplicates.length,
    doNotContact: plan.doNotContact.slice(0, 30),
    doNotContactCount: plan.doNotContact.length,
    inserted,
  });
}
