import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { describePending, track } from "./pending";

/** A promise that settles when told to. */
function later<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const p = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { p, resolve, reject };
}

describe("the home page's pending reads", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-18T15:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); });

  it("says nothing is pending when every read has answered", async () => {
    const a = later<number>();
    const t = track("q1 published(24)", a.p);
    a.resolve(1);
    await t;
    expect(describePending()).toBe("nothing pending");
  });

  it("names a read that has not answered, and for how long", async () => {
    const a = later<number>();
    void track("q4 govs(5000)", a.p);
    vi.advanceTimersByTime(8000);
    expect(describePending()).toBe("q4 govs(5000) 8000 ms");
    a.resolve(1);
    await Promise.resolve();
  });

  it("forgets a read that failed, too", async () => {
    const a = later<number>();
    const t = track("q2 nouveautes(12)", a.p).catch(() => "failed");
    a.reject(new Error("boom"));
    expect(await t).toBe("failed");
    expect(describePending()).toBe("nothing pending");
  });

  it("shows the same read asked by several renders once, with how many and the oldest age", async () => {
    const a = later<number>();
    const b = later<number>();
    void track("q4 govs(5000)", a.p);
    vi.advanceTimersByTime(3000);
    void track("q4 govs(5000)", b.p);
    vi.advanceTimersByTime(5000);
    expect(describePending()).toBe("q4 govs(5000) ×2 8000 ms");
    a.resolve(1);
    b.resolve(1);
    await Promise.resolve();
  });

  it("lists the oldest first and caps the list", async () => {
    const reads = Array.from({ length: 8 }, () => later<number>());
    reads.forEach((r, i) => { void track(`q${i}`, r.p); vi.advanceTimersByTime(100); });
    const text = describePending(Date.now(), 3);
    expect(text.startsWith("q0 800 ms, q1 700 ms, q2 600 ms")).toBe(true);
    expect(text.endsWith(", +5 more")).toBe(true);
    reads.forEach((r) => r.resolve(1));
    await Promise.resolve();
  });
});

describe("the home page's timeout message", () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

  it("keeps its old name first and tells where it stood and what was waiting", () => {
    const page = read("src/app/[locale]/(home)/page.tsx");
    expect(page).toContain("`home_data_timeout${describe ?");
    expect(page).toContain("describePending()");
    expect(page).toMatch(/where\.stage = "feed"/);
  });

  it("lists every read of the feed as pending while it waits", () => {
    expect(read("src/lib/home/feed.ts")).toMatch(/track\(label, p\)/);
  });
});
