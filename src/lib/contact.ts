/**
 * How people reach Mazed Immo.
 *
 * WhatsApp is the channel, for messages only — nobody answers calls on it, so
 * the site never offers to dial it (no tel: link). The number is the
 * `contact_whatsapp` setting (/admin/settings → Contact; +216 58 415 510, given
 * by the owner on 2026-10-26, by default): `useSetting` in the browser,
 * `getSettings()` on the server.
 */

/** A wa.me link to a number, with an opening line already typed. */
export function whatsappHref(number: string, text?: string): string {
  const digits = number.replace(/\D/g, "");
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

/**
 * The `contact_tiktok` setting as a bare handle: an admin may type it with
 * its « @ » or paste the whole profile link.
 */
export function tiktokHandle(value: string): string {
  return value.trim().replace(/^https?:\/\/(www\.)?tiktok\.com\//i, "").replace(/^@/, "").replace(/[/?#].*$/, "");
}

export function tiktokHref(value: string): string {
  return `https://www.tiktok.com/@${tiktokHandle(value)}`;
}

/**
 * The link for the `contact_facebook` setting: a pasted link as it is, a
 * numeric profile id (a page without a name, like Mazed Immo's on 2026-11-02)
 * through profile.php, anything else as the page's name.
 */
export function facebookHref(value: string): string {
  const v = value.trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (/^\d+$/.test(v)) return `https://www.facebook.com/profile.php?id=${v}`;
  return `https://www.facebook.com/${v.replace(/^@/, "")}`;
}
