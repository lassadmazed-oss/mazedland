import { getServiceSupabase } from "@/lib/supabase/admin";
import { loadSettings } from "@/lib/settings/server";

/**
 * GET /indexnow.txt — the IndexNow key (src/lib/indexnow.ts): the engines read
 * it to check that a submission comes from this site. Public by design.
 * 404 while IndexNow is off in the console.
 */
export const revalidate = 3600;

export async function GET() {
  const settings = await loadSettings(getServiceSupabase());
  if (!settings.seo_indexnow_enabled || !settings.seo_indexnow_key) return new Response("Not found", { status: 404 });
  return new Response(settings.seo_indexnow_key, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
