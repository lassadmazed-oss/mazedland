import { describe, expect, it } from "vitest";
import { isForeignNoise } from "./noise";

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
