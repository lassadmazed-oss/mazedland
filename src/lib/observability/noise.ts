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
  // React found a part of the page it could not take over from the HTML the browser
  // holds — a translator or in-app browser changed it, or the download was cut — and
  // drew that part itself; the visitor sees the page. Seen on the home page from one
  // Android that also raised #418 and from Facebook's iOS browser. A server render
  // that really failed is logged on the server (instrumentation.ts), not here.
  /Minified React error #419\b/,
  // A browser extension talking to its own page script: the page asked it something
  // (« chrome: call method ») and it never answered, or it promised an answer and the
  // channel closed first. Both come from the visitor's extensions, never from our code
  // (the phrases are nowhere in this repo), carry no stack, and showed up on /fr/admin
  // and a Facebook-shared annonce from one Edge with extensions, then on the home page.
  /Window message ["'][^"']*["'] timed out/i,
  /A listener indicated an asynchronous response by returning true, but the message channel closed/i,
];

/** True when the message is browser or app noise that the error log should not keep. */
export function isForeignNoise(message: unknown): boolean {
  if (typeof message !== "string") return false;
  return FOREIGN.some((re) => re.test(message));
}
