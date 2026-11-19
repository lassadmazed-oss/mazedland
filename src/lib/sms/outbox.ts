/**
 * WinSMS's outbox, read for what the site cannot see at send time.
 *
 * `send-sms` answers « Successfully Send » as soon as the message is queued; the
 * provider's own worker then delivers it — or fails (2026-11-14: « Fatal error:
 * Uncaught mysqli_sql_exception: Connection refused in …/sendsms.php », for every
 * message from 11:51 UTC, while the answer to us stayed « ok » and the balance
 * still dropped). The only place the truth shows is `get-inbox`: every message
 * the account sent, oldest first, with a `status`, and no timestamps.
 *
 * Pure: the parsing and the verdicts, tested; src/lib/sms/health.ts does the I/O.
 */

export type OutboxRow = { id: number; phone: string; sms: string; segments: number; type: string; status: string };

/** The list out of `get-inbox`'s JSON, oldest first; anything unreadable is left out. */
export function parseOutbox(json: unknown): OutboxRow[] {
  const holder = json as { data?: unknown; messages?: unknown } | null;
  const list = Array.isArray(json) ? json : Array.isArray(holder?.data) ? holder.data : Array.isArray(holder?.messages) ? holder.messages : [];
  const rows: OutboxRow[] = [];
  for (const m of list as Record<string, unknown>[]) {
    const id = Number(m?.id);
    if (!Number.isFinite(id)) continue;
    rows.push({
      id,
      phone: String(m.phone ?? ""),
      sms: String(m.sms ?? ""),
      segments: Number(m.segments ?? 1) || 1,
      type: String(m.type ?? ""),
      status: String(m.status ?? ""),
    });
  }
  return rows.sort((a, b) => a.id - b.id);
}

/**
 * A status that says the PROVIDER failed, not that this number could not be
 * reached (« Mobile Error SMS counted » is the number's: a wrong or dead line).
 * These are the provider's own PHP and cURL errors, stored as the status.
 */
const PROVIDER_FAILURE = /fatal error|connection refused|curl error|failed to connect|sql_?exception|mysqli|too many connections|service unavailable/i;

export function isProviderFailure(status: string): boolean {
  return PROVIDER_FAILURE.test(status);
}

/** A short word for the admins' notice: what the provider said, without its HTML. */
export function failureReason(status: string): string {
  if (/connection refused/i.test(status)) return "Connection refused";
  if (/curl error/i.test(status)) return "cURL error";
  if (/too many connections/i.test(status)) return "Too many connections";
  if (/service unavailable/i.test(status)) return "Service unavailable";
  if (/fatal error|sql_?exception|mysqli/i.test(status)) return "Fatal error";
  return "Provider error";
}

/** How many of the newest messages must all have failed before the provider counts as down. */
export const DOWN_RUN = 3;

/** Down when the newest `run` messages ALL failed on the provider's side: one bad line is not an outage. */
export function providerDown(rows: readonly OutboxRow[], run: number = DOWN_RUN): boolean {
  if (rows.length < run) return false;
  return rows.slice(-run).every((r) => isProviderFailure(r.status));
}

/** The provider-side failures newer than `afterId`, oldest first. */
export function failuresAfter(rows: readonly OutboxRow[], afterId: number): OutboxRow[] {
  return rows.filter((r) => r.id > afterId && isProviderFailure(r.status));
}

/** Digits only, the way WinSMS lists a number (« 216XXXXXXXX »). */
export function digitsOf(phone: string): string {
  return phone.replace(/\D/g, "");
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * The annonce an owner's SMS from Prospection is about. That message carries
 * the owner's private link (/gerer/…) beside the annonce's own link, which no
 * other SMS does; null for anything else.
 */
export function ownerSmsListing(text: string): string | null {
  if (!/\/gerer\//.test(text)) return null;
  const m = new RegExp(`/annonces/(${UUID})`, "i").exec(text);
  return m ? m[1].toLowerCase() : null;
}

/** Does a notification's SMS carry this notification's link? (It ends with it: `${origin}/${lang}${link}`.) */
export function smsCarriesLink(text: string, link: string | null): boolean {
  return !!link && link.length > 1 && text.includes(link);
}
