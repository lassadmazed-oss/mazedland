import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { revokeTiktokToken } from "@/lib/social/tiktok";
import { openTiktokTokens, tiktokConfig } from "@/lib/social/tiktokConnect";

/**
 * DELETE /api/admin/social/accounts/:id — disconnect a page (or the TikTok
 * account). The token is erased, not just flagged; the jobs that would have
 * used it go to a person. TikTok is also told to forget the grant.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req, "social");
  if (gate instanceof NextResponse) return gate;
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { data: acc } = await admin.from("social_accounts").select("platform, token_sealed").eq("id", id).maybeSingle();
  const app = acc?.platform === "tiktok" && acc.token_sealed ? tiktokConfig() : null;
  if (app) {
    try {
      await revokeTiktokToken({ ...app, token: openTiktokTokens(acc!.token_sealed as string).accessToken });
    } catch {
      // A token that no longer opens is erased all the same.
    }
  }

  // The page and the Instagram account that posts with its token.
  const { data: linked } = await admin.from("social_accounts").select("id").eq("parent_account_id", id);
  const ids = [id, ...((linked ?? []) as { id: string }[]).map((a) => a.id)];
  const { error } = await admin
    .from("social_accounts")
    .update({ status: "disconnected", token_sealed: null, token_expires_at: null })
    .in("id", ids);
  if (error) return fail("account_disconnect_failed", 500, error);
  await admin
    .from("social_publication_jobs")
    .update({ status: "manual_action_required", manual_reason: "no_account" })
    .in("account_id", ids)
    .eq("status", "scheduled");
  logAction(req, gate.user, "social.account_disconnect", { id });
  return NextResponse.json({ ok: true });
}
