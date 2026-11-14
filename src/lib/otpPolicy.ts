/**
 * What may be asked of /api/auth/phone/send, and how often (security audit,
 * 2026-11-14). The numbers are the ones the route always used; they live here
 * so the route, the SQL function that enforces them and the tests share one set.
 */

/** Minimum gap between two codes sent to one number. */
export const OTP_COOLDOWN_SECS = 60;
/** The window the per-number cap counts in. */
export const OTP_WINDOW_SECS = 60 * 60;
/** Codes per number per window. */
export const OTP_MAX_PER_WINDOW = 5;
/** How long a code can be entered. */
export const OTP_TTL_SECS = 10 * 60;
/** Wrong guesses a code survives. */
export const OTP_MAX_ATTEMPTS = 5;
/** The key of the budget shared by every number (`otp_daily_cap`). */
export const OTP_GLOBAL_KEY = "otp:global";

/**
 * True when this E.164 number starts with a dial code the forms offer
 * (`otp_dial_codes`, by default the ones in src/lib/tunisia.ts). The route used
 * to take any `+` and 8 to 15 digits: a script could have a code sent to any
 * number in the world, premium-rate ranges included, at our cost.
 */
export function dialCodeAllowed(phone: string, codes: readonly string[]): boolean {
  return codes.some((c) => /^\+\d{1,4}$/.test(c) && phone.startsWith(c) && phone.length - c.length >= 6);
}
