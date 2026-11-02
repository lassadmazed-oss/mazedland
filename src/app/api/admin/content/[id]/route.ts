import { NextRequest, NextResponse } from "next/server";
import { jsonObject } from "@/lib/http/body";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { logAction } from "@/lib/activity";
import { audit } from "@/lib/admin/audit";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { auditView, canPublish, changedKeys, parseArticleInput, type Article } from "@/lib/guides/articles";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

async function loadRow(admin: Admin, id: string): Promise<Article | null> {
  if (!UUID.test(id)) return null;
  const { data } = await admin.from("articles").select("*").eq("id", id).maybeSingle();
  return (data as Article | null) ?? null;
}

/**
 * PATCH /api/admin/content/[id] — the editor's « Enregistrer », « Publier »
 * and « Dépublier » (0208).
 *
 * Only the fields sent are read; the slug is not one of them (a guide's
 * address is fixed on creation). `status: "published"` goes through only once
 * the guide, with this very save applied, has a title and a body in one
 * language — the table says so too (articles_published_complete), but the
 * editor deserves the reason. The first publication sets `published_at`;
 * taking a guide offline keeps it, so it comes back with its date.
 *
 * Every save leaves an admin_audit entry naming the fields that moved.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req, "content");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const { id } = await params;
  const row = await loadRow(admin, id);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await jsonObject(req);
  const t = await apiTranslator(req, "adminContent.api");
  const parsed = parseArticleInput(body, { partial: true });
  if (!parsed.ok) {
    return NextResponse.json({ error: "invalid", field: parsed.error, detail: t(parsed.error) }, { status: 400 });
  }

  const patch: Record<string, unknown> = { ...parsed.value };
  let action = "article.update";
  if ("status" in body) {
    if (body.status !== "draft" && body.status !== "published") {
      return NextResponse.json({ error: "invalid", field: "status", detail: t("status") }, { status: 400 });
    }
    if (body.status === "published") {
      if (!canPublish({ ...row, ...parsed.value })) {
        return NextResponse.json({ error: "invalid", field: "publish", detail: t("cannotPublish") }, { status: 400 });
      }
      patch.status = "published";
      patch.published_at = row.published_at ?? new Date().toISOString();
      if (row.status !== "published") action = "article.publish";
    } else {
      patch.status = "draft";
      if (row.status === "published") action = "article.unpublish";
    }
  }

  const { error } = await admin.from("articles").update(patch).eq("id", row.id);
  if (error) return fail("article_update_failed", 500, error);

  const before = auditView(row);
  const after = auditView({ ...row, ...(patch as Partial<Article>) });
  const changed = changedKeys(before, after);
  logAction(req, user, `admin.${action}`, { id: row.id, slug: row.slug, changed });
  if (changed.length > 0) {
    await audit(admin, user.id, {
      action,
      targetType: "article",
      targetId: row.id,
      before: Object.fromEntries(changed.map((k) => [k, before[k] ?? null])),
      after: Object.fromEntries(changed.map((k) => [k, after[k] ?? null])),
      note: row.slug,
    });
  }
  return NextResponse.json({ ok: true, id: row.id, status: patch.status ?? row.status, changed });
}

/** DELETE /api/admin/content/[id] — the guide goes; its cover is swept with the abandoned uploads. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req, "content");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const { id } = await params;
  const row = await loadRow(admin, id);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { error } = await admin.from("articles").delete().eq("id", row.id);
  if (error) return fail("article_delete_failed", 500, error);

  logAction(req, user, "admin.article.delete", { id: row.id, slug: row.slug, status: row.status });
  await audit(admin, user.id, { action: "article.delete", targetType: "article", targetId: row.id, before: auditView(row), note: row.slug });
  return NextResponse.json({ ok: true });
}
