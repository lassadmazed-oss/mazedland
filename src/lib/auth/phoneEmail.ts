/**
 * The synthetic address an account made with a phone number carries. Nothing is
 * ever sent to it; it only gives Supabase a unique handle, and the one-account-
 * per-phone guard rests on it. Shared by the signup and by Prospection, which
 * makes the account of an owner who said yes to the team.
 *
 * Override the domain with SIGNUP_EMAIL_DOMAIN to point at one we own (audit
 * #16/#19: the default is not ours, a latent takeover vector if email-based
 * recovery is ever turned on).
 */
export const PHONE_EMAIL_DOMAIN = process.env.SIGNUP_EMAIL_DOMAIN || "phone.mazedland.app";

/** `+216 58 415 521` → `21658415521@<domain>`. */
export function phoneEmail(phone: string): string {
  return `${phone.replace(/\D/g, "")}@${PHONE_EMAIL_DOMAIN}`;
}
