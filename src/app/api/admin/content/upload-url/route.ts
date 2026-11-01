import { NextRequest, NextResponse } from "next/server";
import { jsonObject } from "@/lib/http/body";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { ARTICLE_COVER, articleCoverExt } from "@/lib/guides/articles";

/**
 * POST /api/admin/content/upload-url  { ext, size } → { path, signedUrl }
 *
 * A signed upload URL for a guide's cover, as the ads' banners have one
 * (/api/admin/ads/upload-url): the browser PUTs the bytes itself. The path is
 * chosen here — `articles/<uuid>.<ext>` in the public `properties` bucket —
 * and only JPG, PNG and WebP; the size is the one the console declares, a
 * courtesy to the page the cover will show on, not a defence.
 */
export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, "content");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const body = (await jsonObject(req)) as { ext?: unknown; size?: unknown };
  const t = await apiTranslator(req, "adminContent.api");
  const ext = articleCoverExt(String(body.ext ?? ""));
  if (!ext) return NextResponse.json({ error: "invalid", detail: t("imageType") }, { status: 400 });
  const size = Number(body.size);
  if (!Number.isFinite(size) || size <= 0 || size > ARTICLE_COVER.maxBytes) {
    return NextResponse.json(
      { error: "invalid", detail: t("imageSize", { max: Math.round(ARTICLE_COVER.maxBytes / 1024 / 1024) }) },
      { status: 400 },
    );
  }

  // Every URL is a write into a public bucket: a ceiling, even for an admin.
  const { data: over } = await admin.rpc("check_rate_limit", {
    p_key: `article-upload:${user.id}`,
    p_max: 60,
    p_window_secs: 3600,
  });
  if (over === true) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const path = `articles/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await admin.storage.from("properties").createSignedUploadUrl(path);
  if (error || !data?.signedUrl) return fail("signed_url_failed", 500, error);

  logAction(req, user, "admin.article.upload", { path, size });
  return NextResponse.json({ ok: true, path, signedUrl: data.signedUrl });
}
