import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ getServiceSupabase: () => null }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));

describe("the home feed's queue (2026-11-25)", () => {
  it("runs at most n tasks at once, all of them, in order", async () => {
    const { gate } = await import("./feed");
    const slot = gate(2);
    let running = 0;
    let peak = 0;
    const started: number[] = [];
    const task = (i: number) => () =>
      new Promise<number>((resolve) => {
        running++;
        peak = Math.max(peak, running);
        started.push(i);
        setTimeout(() => {
          running--;
          resolve(i);
        }, 5);
      });
    const results = await Promise.all([0, 1, 2, 3, 4].map((i) => slot(task(i))));
    expect(results).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(2);
    expect(started).toEqual([0, 1, 2, 3, 4]);
  });

  it("does not start a lazy query before its turn, and passes errors through", async () => {
    const { gate } = await import("./feed");
    const slot = gate(1);
    const sent: string[] = [];
    const lazy = (name: string, fail = false) =>
      ({
      then(ok: (v: string) => void, ko: (e: Error) => void) {
        sent.push(name);
        if (fail) ko(new Error(name));
        else ok(name);
      },
    }) as unknown as PromiseLike<string>;
    const a = slot(() => lazy("a"));
    const b = slot(() => lazy("b", true));
    expect(sent).toEqual([]);
    await expect(a).resolves.toBe("a");
    await expect(b).rejects.toThrow("b");
    expect(sent).toEqual(["a", "b"]);
  });
});
