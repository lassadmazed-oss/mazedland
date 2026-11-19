import type { SupabaseClient } from "@supabase/supabase-js";
import { recentHits, recordHit } from "@/lib/rateLimitCount";

/**
 * The limit on password guesses at /api/auth/login-by-phone.
 *
 * It used to count EVERY attempt per number — 10 in 15 minutes — so ten requests
 * from anywhere locked the real owner out (a seller's number is on every annonce)
 * and a successful sign-in spent the budget too. Now only FAILURES count, twice:
 *
 *   · per number AND address: ten wrong guesses in 15 minutes close the door for
 *     that address on that number. Someone guessing locks themselves out, not the
 *     owner, who signs in from elsewhere.
 *   · per number, whoever asks: forty wrong guesses in an hour close it for all,
 *     the ceiling that keeps a guesser using many addresses from walking through
 *     a password list. Reaching it takes forty failures an hour, not ten requests.
 *
 * No lockout is free of this trade-off without a challenge the person can pass;
 * the owner can always set a new password by SMS code, which has its own limits.
 */
export const LOGIN_PAIR_MAX = 10;
export const LOGIN_PAIR_WINDOW_SECS = 15 * 60;
export const LOGIN_PHONE_MAX = 40;
export const LOGIN_PHONE_WINDOW_SECS = 60 * 60;

type Client = Pick<SupabaseClient, "from" | "rpc">;

export const loginKeys = (phone: string, ip: string) => ({
  pair: `loginfail:${phone}:${ip}`,
  phone: `loginfail:${phone}`,
});

/** Whether a sign-in for this number from this address is refused before the password is looked at. */
export async function loginBlocked(admin: Client, phone: string, ip: string): Promise<boolean> {
  const k = loginKeys(phone, ip);
  const [pair, any] = await Promise.all([
    recentHits(admin, k.pair, LOGIN_PAIR_WINDOW_SECS),
    recentHits(admin, k.phone, LOGIN_PHONE_WINDOW_SECS),
  ]);
  return pair >= LOGIN_PAIR_MAX || any >= LOGIN_PHONE_MAX;
}

/** A wrong password, or a number with no account (the answer is the same either way). */
export async function recordLoginFailure(admin: Client, phone: string, ip: string): Promise<void> {
  const k = loginKeys(phone, ip);
  await Promise.all([
    recordHit(admin, k.pair, LOGIN_PAIR_WINDOW_SECS),
    recordHit(admin, k.phone, LOGIN_PHONE_WINDOW_SECS),
  ]);
}
