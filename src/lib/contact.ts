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

/**
 * The `contact_instagram` setting as a bare handle: typed with or without
 * its « @ », or the profile link pasted from the app (with its trailing
 * slash or « ?igsh=… »).
 */
export function instagramHandle(value: string): string {
  return value.trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").replace(/[/?#].*$/, "");
}

export function instagramHref(value: string): string {
  return `https://www.instagram.com/${instagramHandle(value)}/`;
}

export type MazedLink = { key: "facebook" | "instagram" | "tiktok" | "email"; href: string };

/**
 * Mazed Immo's own addresses, as links to tap instead of typing them — the
 * campaign form's « Lien » (the owner, 2026-11-03: Facebook, TikTok,
 * Instagram and contact@mazed.immo in the publicités). An empty setting is
 * left out, as on the contact page.
 */
export function mazedLinks(s: { contact_facebook: string; contact_instagram: string; contact_tiktok: string; contact_email: string }): MazedLink[] {
  const out: MazedLink[] = [];
  if (s.contact_facebook.trim()) out.push({ key: "facebook", href: facebookHref(s.contact_facebook) });
  if (s.contact_instagram.trim()) out.push({ key: "instagram", href: instagramHref(s.contact_instagram) });
  if (s.contact_tiktok.trim()) out.push({ key: "tiktok", href: tiktokHref(s.contact_tiktok) });
  if (s.contact_email.trim()) out.push({ key: "email", href: `mailto:${s.contact_email.trim()}` });
  return out;
}
