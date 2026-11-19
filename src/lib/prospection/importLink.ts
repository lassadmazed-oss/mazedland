/**
 * The post the Chrome extension hands to « Nouvelle annonce trouvée »
 * (extension/prospection). It travels in the URL's FRAGMENT — `#import=<base64url>` —
 * which a browser never sends to a server: the post's text is read by the page
 * that opens and by nothing else on the way. The member checks the form and
 * sends it themselves, so a crafted link can at most fill a form.
 *
 * Pure, and the same on both sides: the extension writes it
 * (extension/prospection/extract.js encodePayload) and this reads it back.
 */
export type ImportedPost = { text: string; url: string; name: string };

/** More than this in a link is not a post. */
const MAX_HASH_CHARS = 24_000;
const MAX_TEXT = 8_000;

const clip = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function decodeImport(hash: string): ImportedPost | null {
  const m = /^#import=([A-Za-z0-9_-]+)$/.exec(hash);
  if (!m || m[1].length > MAX_HASH_CHARS) return null;
  try {
    const b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const j = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown> | null;
    if (!j || typeof j !== "object" || j.v !== 1) return null;
    const text = clip(j.text, MAX_TEXT);
    if (!text) return null;
    const url = clip(j.url, 600);
    return { text, url: /^https?:\/\//i.test(url) ? url : "", name: clip(j.name, 120) };
  } catch {
    return null;
  }
}
