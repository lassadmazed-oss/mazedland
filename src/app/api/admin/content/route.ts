import { NextRequest, NextResponse } from "next/server";
import { jsonObject } from "@/lib/http/body";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { logAction } from "@/lib/activity";
import { audit } from "@/lib/admin/audit";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { auditView, parseArticleInput } from "@/lib/guides/articles";

/**
 * POST /api/admin/content — a new guide (0208), as a draft, for /admin/contenu.
 *
 * The body is the editor's form: the slug (made from the French title, fixed
 * from here on), the texts of both languages, the tags, the cover's path and
 * the search snippet. Checked field by field (src/lib/guides/articles.ts) so
 * the editor hears which one is wrong; the slug must be free. Admin-only,
 * through the service role: `articles` takes no write from a client role.
 */
export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, "content");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const body = await jsonObject(req);
  const t = await apiTranslator(req, "adminContent.api");
  const parsed = parseArticleInput(body, { partial: false });
  if (!parsed.ok) {
    return NextResponse.json({ error: "invalid", field: parsed.error, detail: t(parsed.error) }, { status: 400 });
  }

  const { data: taken } = await admin.from("articles").select("id").eq("slug", parsed.value.slug!).maybeSingle();
  if (taken) return NextResponse.json({ error: "conflict", field: "slug", detail: t("slugTaken") }, { status: 409 });

  const { data, error } = await admin
    .from("articles")
    .insert({ ...parsed.value, status: "draft", author_id: user.id })
    .select("id, slug")
    .single();
  if (error) return fail("article_create_failed", 500, error);

  logAction(req, user, "admin.article.create", { id: data.id, slug: data.slug });
  await audit(admin, user.id, {
    action: "article.create",
    targetType: "article",
    targetId: data.id,
    after: auditView({ ...parsed.value, status: "draft" }),
  });
  return NextResponse.json({ ok: true, id: data.id, slug: data.slug });
}
