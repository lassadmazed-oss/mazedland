import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { logAction } from "@/lib/activity";
import { audit } from "@/lib/admin/audit";
import { fail } from "@/lib/http/errors";
import { readStarterGuides } from "@/lib/guides/starterServer";
import { starterRow } from "@/lib/guides/starter";

/**
 * POST /api/admin/content/import — « Importer les guides de départ » (0208).
 *
 * The ten guides written for Tunisia (docs/guides/*.md, French and Arabic)
 * become DRAFTS in the console, nothing more: the owner reads each one,
 * changes what they want and publishes it themselves. Only on this click —
 * never at deploy, never by a job — and never twice: a guide already imported
 * (`source_key`) or an address already taken is skipped and named in the answer.
 */
export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, "content");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  let guides;
  try {
    guides = readStarterGuides();
  } catch (e) {
    return fail("starter_read_failed", 500, e);
  }
  if (guides.length === 0) return NextResponse.json({ ok: true, imported: [], skipped: [] });

  const slugs = guides.map((g) => g.slug);
  const { data: existing, error: exErr } = await admin
    .from("articles")
    .select("slug, source_key")
    .or(`slug.in.(${slugs.join(",")}),source_key.in.(${slugs.join(",")})`);
  if (exErr) return fail("articles_read_failed", 500, exErr);
  const taken = new Set<string>();
  for (const r of (existing ?? []) as { slug: string; source_key: string | null }[]) {
    taken.add(r.slug);
    if (r.source_key) taken.add(r.source_key);
  }

  const toInsert = guides.filter((g) => !taken.has(g.slug));
  const skipped = guides.filter((g) => taken.has(g.slug)).map((g) => g.slug);
  if (toInsert.length > 0) {
    const { error } = await admin.from("articles").insert(toInsert.map((g) => ({ ...starterRow(g), author_id: user.id })));
    if (error) return fail("article_import_failed", 500, error);
  }
  const imported = toInsert.map((g) => g.slug);

  logAction(req, user, "admin.article.import", { imported: imported.length, skipped: skipped.length });
  if (imported.length > 0) {
    await audit(admin, user.id, { action: "article.import", targetType: "article", after: { imported, skipped } });
  }
  return NextResponse.json({ ok: true, imported, skipped });
}
