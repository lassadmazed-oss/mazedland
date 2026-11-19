/**
 * What the activity log must not keep.
 *
 * The private link an owner receives by SMS (`/gerer/<token>`, Prospection)
 * is a 365-day bearer credential: whoever holds the address can mark the annonce
 * sold or take it down. The log stored the full address (every page view of it,
 * every action through it, the Referer of what was opened from it, the path of
 * a client error on it) for any admin with the activity section to read
 * (security audit, 2026-11-14). It keeps the shape of the address, not the key.
 */
const PRIVATE_LINK = /(\/gerer\/)[^\s/?#"'<>)]+/gi;

/** The same text with the token of a private link taken out. */
export function redactSecrets(text: string): string {
  return text.replace(PRIVATE_LINK, "$1[token]");
}

/** A text field of a log row, redacted; null stays null. */
export function redactField(v: string | null | undefined): string | null {
  return typeof v === "string" ? redactSecrets(v) : (v ?? null);
}

/** The metadata of a log row with every string in it redacted (one level of nesting). */
export function redactMetadata(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (typeof v === "string") out[k] = redactSecrets(v);
    else if (v && typeof v === "object" && !Array.isArray(v)) out[k] = redactMetadata(v as Record<string, unknown>);
    else if (Array.isArray(v)) out[k] = v.map((x) => (typeof x === "string" ? redactSecrets(x) : x));
    else out[k] = v;
  }
  return out;
}
