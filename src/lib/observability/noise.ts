/**
 * Browser errors that are not ours and that nobody can fix from here.
 *
 * Every production error rings the admins' bell (0185), so a message that comes from
 * the visitor's app or an extension, not from the site, costs attention and teaches
 * the owner to ignore the real ones. The client-error sink drops these before they
 * reach the log. Keep the list short and exact: a pattern here hides that error for
 * good, so only add one once its source is known.
 */
const FOREIGN: readonly RegExp[] = [
  // The Android WebView bridge of an in-app browser (Facebook, Messenger, Instagram…)
  // after the app closed its end: seen on every visit that came from a Facebook post.
  /Error invoking postMessage: Java object is gone/i,
  // A browser extension or reader that parses the page's JSON-LD and trips on one
  // block without an @context.
  /\[["']@context["']\]\.toLowerCase/i,
  // A harmless notice: the browser skipped a frame of layout, nothing is broken.
  /ResizeObserver loop (?:limit exceeded|completed with undelivered notifications)/i,
  // A script from another origin failed and the browser hides why: nothing to read.
  /^(?:Uncaught )?Script error\.?$/i,
];

/** True when the message is browser or app noise that the error log should not keep. */
export function isForeignNoise(message: unknown): boolean {
  if (typeof message !== "string") return false;
  return FOREIGN.some((re) => re.test(message));
}
