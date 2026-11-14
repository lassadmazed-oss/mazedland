import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Counting hits without spending one.
 *
 * `check_rate_limit` (0196) counts a hit and answers in one step — right for
 * « every request counts ». Some limits should count only certain outcomes (a
 * failed sign-in, a code actually sent), and then the question « is this key
 * already over? » has to be asked without adding a hit. Reading the table does
 * that; recording goes through the same function so the key's old hits are swept
 * and the write is under its lock.
 *
 * Both fail open: a limiter that cannot be read must not lock honest people out.
 */
type Client = Pick<SupabaseClient, "from" | "rpc">;

/** Hits recorded for this key in the last `windowSecs` seconds. */
export async function recentHits(admin: Client, key: string, windowSecs: number): Promise<number> {
  const since = new Date(Date.now() - windowSecs * 1000).toISOString();
  const { count, error } = await admin
    .from("rate_limits")
    .select("key", { count: "exact", head: true })
    .eq("key", key)
    .gte("hit_at", since);
  return error ? 0 : (count ?? 0);
}

/** One more hit for this key. */
export async function recordHit(admin: Client, key: string, windowSecs: number): Promise<void> {
  await admin.rpc("check_rate_limit", { p_key: key, p_max: 1_000_000_000, p_window_secs: windowSecs });
}
