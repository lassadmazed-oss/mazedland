import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { timeoutSignal } from "./timeoutSignal";

const nativeTimeout = AbortSignal.timeout;

/** Make this Node look like a phone without `AbortSignal.timeout` (Chrome < 103, Safari < 16). */
function removeNativeTimeout() {
  Object.defineProperty(AbortSignal, "timeout", { value: undefined, configurable: true, writable: true });
}

afterEach(() => {
  Object.defineProperty(AbortSignal, "timeout", { value: nativeTimeout, configurable: true, writable: true });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("timeoutSignal", () => {
  it("uses AbortSignal.timeout where the browser has it", () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    const signal = timeoutSignal(10_000);
    expect(spy).toHaveBeenCalledWith(10_000);
    expect(signal.aborted).toBe(false);
  });

  it("does not throw on a browser without AbortSignal.timeout", () => {
    removeNativeTimeout();
    expect(typeof AbortSignal.timeout).toBe("undefined");
    expect(() => timeoutSignal(10_000)).not.toThrow();
  });

  it("aborts after the delay, not before, without AbortSignal.timeout", () => {
    removeNativeTimeout();
    vi.useFakeTimers();
    const signal = timeoutSignal(10_000);
    const onAbort = vi.fn();
    signal.addEventListener("abort", onAbort);

    vi.advanceTimersByTime(9_999);
    expect(signal.aborted).toBe(false);
    expect(onAbort).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(signal.aborted).toBe(true);
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect((signal.reason as DOMException).name).toBe("TimeoutError");
  });

  it("cancels a fetch-like wait the same way, without AbortSignal.timeout", async () => {
    removeNativeTimeout();
    vi.useFakeTimers();
    const signal = timeoutSignal(50);
    const pending = new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
    vi.advanceTimersByTime(50);
    await expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
  });
});

/**
 * Browser code never calls `AbortSignal.timeout` directly: it goes through
 * `timeoutSignal`. Only code that runs on Node (API routes, server-side
 * senders) may, since Node has had it since v17.3.
 */
const SERVER_ONLY = [
  "src/lib/email.ts",
  "src/lib/winsms.ts",
  "src/lib/social/meta.ts",
  "src/lib/geo/server.ts",
  "src/lib/services/providers.ts",
];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe("AbortSignal.timeout guard", () => {
  it("finds no direct AbortSignal.timeout call outside server code", () => {
    const hits: string[] = [];
    for (const file of sourceFiles(path.join(process.cwd(), "src"))) {
      const rel = path.relative(process.cwd(), file).split(path.sep).join("/");
      if (rel === "src/lib/timeoutSignal.ts" || rel.startsWith("src/app/api/") || SERVER_ONLY.includes(rel)) continue;
      fs.readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/AbortSignal\.timeout\s*\(/.test(line)) hits.push(`${rel}:${i + 1}`);
        });
    }
    expect(hits, `Use timeoutSignal() from @/lib/timeoutSignal — AbortSignal.timeout crashes Chrome < 103 / Safari < 16:\n${hits.join("\n")}`).toEqual([]);
  });
});
