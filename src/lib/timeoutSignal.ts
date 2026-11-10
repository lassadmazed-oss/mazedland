/**
 * An AbortSignal that aborts by itself after `ms` milliseconds — the same as
 * `AbortSignal.timeout(ms)`, on every phone.
 *
 * `AbortSignal.timeout()` only exists from Chrome 103, Safari 16 and Firefox
 * 100. On an older WebView the call throws « AbortSignal.timeout is not a
 * function »; inside the favourites sync, which the root layout runs on every
 * page, that TypeError took down the whole page to the root error boundary
 * (2026-11-10: Facebook's in-app browser on Android 9, Chrome 101, opening an
 * annonce from our own « Mazed » page). Browser code uses this instead.
 *
 * The fallback aborts with the same `TimeoutError` reason where the browser
 * accepts a reason; older ones abort with a plain `AbortError`, which every
 * caller here treats alike (a failed fetch).
 */
export function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(timeoutReason()), ms);
  return controller.signal;
}

function timeoutReason(): unknown {
  return typeof DOMException === "function"
    ? new DOMException("signal timed out", "TimeoutError")
    : undefined;
}
