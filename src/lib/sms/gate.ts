import { getServiceSupabase } from "@/lib/supabase/admin";

/**
 * Is WinSMS known to be failing? The verdict is one row (sms_health, 0224)
 * that /api/cron/sms-health keeps up to date. Read through a short memory, so a
 * burst of sends costs one query; unreadable (no table yet, no database) means
 * « not down »: the guard must never be the reason an SMS does not go.
 */
const TTL_MS = 15_000;
let cache: { down: boolean; at: number } | null = null;

export async function smsIsDown(): Promise<boolean> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.down;
  try {
    const admin = getServiceSupabase();
    if (!admin) return false;
    const { data } = await admin.from("sms_health").select("state").eq("id", true).maybeSingle();
    const down = data?.state === "down";
    cache = { down, at: Date.now() };
    return down;
  } catch {
    return false;
  }
}

/** Forget the remembered verdict (the health job has just changed it). */
export function forgetSmsVerdict(): void {
  cache = null;
}
