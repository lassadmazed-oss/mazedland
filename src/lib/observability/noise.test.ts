import { describe, expect, it } from "vitest";
import { isForeignNoise, isForeignSource } from "./noise";

describe("isForeignSource", () => {
  it("drops the script a Facebook or Instagram in-app browser injects into the page", () => {
    expect(isForeignSource("iabjs://browser_declutter:37:40")).toBe(true);
    expect(isForeignSource("IABJS://anything")).toBe(true);
  });

  it("keeps our own scripts, and anything that is not a source", () => {
    expect(isForeignSource("https://www.mazed.immo/_next/static/immutable/chunks/0abc.js:1:2")).toBe(false);
    expect(isForeignSource("digest:123")).toBe(false);
    expect(isForeignSource(undefined)).toBe(false);
    expect(isForeignSource("")).toBe(false);
  });
});

describe("isForeignNoise", () => {
  it("drops the in-app browser bridge error seen on Facebook visits", () => {
    expect(isForeignNoise("Uncaught Error: Error invoking postMessage: Java object is gone")).toBe(true);
  });

  it("drops a reader or extension that trips on JSON-LD", () => {
    expect(isForeignNoise("TypeError: undefined is not an object (evaluating 'r[\"@context\"].toLowerCase')")).toBe(true);
  });

  it("drops the harmless ResizeObserver notices", () => {
    expect(isForeignNoise("ResizeObserver loop completed with undelivered notifications.")).toBe(true);
    expect(isForeignNoise("ResizeObserver loop limit exceeded")).toBe(true);
  });

  it("drops a cross-origin « Script error. » that carries nothing to read", () => {
    expect(isForeignNoise("Script error.")).toBe(true);
    expect(isForeignNoise("Uncaught Script error")).toBe(true);
  });

  it("drops React's notice that it redrew a part of the page the browser had changed", () => {
    expect(isForeignNoise("Uncaught Error: Minified React error #419; visit https://react.dev/errors/419 for the full message")).toBe(true);
    // Safari's in-app browsers leave out « Uncaught ».
    expect(isForeignNoise("Error: Minified React error #419; visit https://react.dev/errors/419 for the full message")).toBe(true);
    expect(isForeignNoise("Uncaught Error: Minified React error #4190")).toBe(false);
  });

  it("drops an extension's messages to its own page script that were never answered", () => {
    expect(isForeignNoise('Error: Window message "chrome: call method" timed out.')).toBe(true);
    expect(isForeignNoise('Uncaught (in promise) Error: Window message "other call" timed out')).toBe(true);
    expect(isForeignNoise("Error: A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received")).toBe(true);
  });

  it("drops the iPhone bridge of Facebook's in-app browser", () => {
    expect(isForeignNoise("TypeError: undefined is not an object (evaluating 'window.webkit.messageHandlers')")).toBe(true);
    expect(isForeignNoise("TypeError: undefined is not an object (evaluating 'window.webkit.messageHandlers.fbIAB')")).toBe(true);
    // An error of ours that merely mentions webkit is still ours.
    expect(isForeignNoise("TypeError: webkitRequestFullscreen is not a function")).toBe(false);
  });

  it("keeps a timeout that is the site's own", () => {
    expect(isForeignNoise("Error: Request to /api/listings timed out.")).toBe(false);
    expect(isForeignNoise("TimeoutError: signal timed out")).toBe(false);
    expect(isForeignNoise("Error: Window message handler failed")).toBe(false);
  });

  it("keeps the site's own errors", () => {
    expect(isForeignNoise("Uncaught Error: Minified React error #418; visit https://react.dev/errors/418")).toBe(false);
    expect(isForeignNoise("TypeError: Cannot read properties of null (reading 'name')")).toBe(false);
    expect(isForeignNoise("GPUInitializationError: WebGL2 is required to display this map.")).toBe(false);
    // A real script error that says what went wrong is not « Script error. ».
    expect(isForeignNoise("Script error: x is not defined")).toBe(false);
  });

  it("ignores anything that is not a message", () => {
    expect(isForeignNoise(undefined)).toBe(false);
    expect(isForeignNoise(null)).toBe(false);
    expect(isForeignNoise(42)).toBe(false);
    expect(isForeignNoise("")).toBe(false);
  });
});
