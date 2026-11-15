import { NextRequest } from "next/server";
import { getSettings } from "@/lib/settings/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/social/image/<file>.txt — the signature file TikTok asks for to
 * verify the URL prefix https://www.mazed.immo/api/social/image/, the one
 * the annonce photos are pulled from (developers.tiktok.com → the app →
 * « Verify properties » → URL prefix). Its name and its text are pasted in
 * Réglages → Réseaux sociaux (social_tiktok_verify_file / _text), so no
 * deploy is needed. Any other name is a plain 404, like an unknown photo.
 *
 * Verifying the domain mazed.immo by a DNS record instead covers this too;
 * then the two settings stay empty.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId: file } = await params;
  const s = await getSettings();
  const name = s.social_tiktok_verify_file.trim();
  const text = s.social_tiktok_verify_text.trim();
  if (!name || !text || file !== name) return new Response("Not found", { status: 404 });
  return new Response(text, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
