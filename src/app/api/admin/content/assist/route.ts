import { NextRequest, NextResponse } from "next/server";
import { jsonObject } from "@/lib/http/body";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { featureOff } from "@/lib/settings/gate";
import { aiAvailable, callJson } from "@/lib/ai/server";
import { ASSIST_SCHEMA, buildAssistSystemPrompt, buildAssistUserPrompt, cleanAssistMarkdown, parseAssistInput } from "@/lib/guides/assist";

/**
 * POST /api/admin/content/assist — « Aide à la rédaction » (0208): a draft of
 * one section, or of a whole guide, in French or Arabic, from the guide's
 * title and what is written so far. The answer goes back to the editor as
 * Markdown and nowhere else: nothing here writes a row, and nothing the model
 * says is published without the owner's hand.
 *
 * Through the one door to the model (src/lib/ai/server.ts): the key, the
 * `ai_enabled` switch, the daily budgets and the `ai_calls` log apply; this
 * screen adds its own switch (`guides_ai_assist`) and a cap per member.
 */
export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, "content");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;
  const off = await featureOff("guides_ai_assist");
  if (off) return off;

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const t = await apiTranslator(req, "adminContent.assist.api");
  const parsed = parseAssistInput(await jsonObject(req));
  if (!parsed.ok) return NextResponse.json({ error: "invalid", field: parsed.error, detail: t(parsed.error) }, { status: 400 });

  const { data: over } = await admin.rpc("check_rate_limit", {
    p_key: `guides-assist:${user.id}`,
    p_max: 30,
    p_window_secs: 3600,
  });
  if (over === true) return NextResponse.json({ error: "rate_limited", detail: t("rateLimited") }, { status: 429 });

  if (!(await aiAvailable(admin))) return NextResponse.json({ error: "ai_unavailable", detail: t("unavailable") }, { status: 503 });

  const res = await callJson({
    admin,
    userId: user.id,
    feature: "guides_assist",
    system: buildAssistSystemPrompt(),
    user: buildAssistUserPrompt(parsed.value),
    schema: ASSIST_SCHEMA,
    maxTokens: 3000,
  });
  if (!res.ok) {
    const refused = res.reason === "refused";
    return NextResponse.json({ error: refused ? "ai_refused" : "ai_failed", detail: t(refused ? "refused" : "failed") }, { status: 503 });
  }
  const markdown = cleanAssistMarkdown((res.data as { markdown?: unknown }).markdown);
  if (!markdown) return NextResponse.json({ error: "ai_failed", detail: t("failed") }, { status: 503 });

  logAction(req, user, "admin.article.assist", { language: parsed.value.language, section: parsed.value.heading !== null, chars: markdown.length });
  return NextResponse.json({ ok: true, markdown });
}
