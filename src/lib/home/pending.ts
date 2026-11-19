/**
 * The home page's database reads that have been asked and not yet answered.
 *
 * When the home page's data phase runs out of time (« home_data_timeout »,
 * page.tsx), the error used to say only that it did: 7 of them on 2026-11-18
 * and no way to tell which read was the slow one, or whether it was a read at
 * all. The page now adds what was still waiting, and for how long, to the
 * message that lands in the error log.
 *
 * Per server instance, shared by the renders it runs at the same moment, so
 * the same read asked by several renders is shown once with how many.
 */
type Entry = { label: string; at: number };

const open = new Map<number, Entry>();
let seq = 0;

/** `p`, listed as pending until it settles (resolved or rejected). */
export function track<T>(label: string, p: PromiseLike<T>): Promise<T> {
  const id = ++seq;
  open.set(id, { label, at: Date.now() });
  return Promise.resolve(p).finally(() => {
    open.delete(id);
  });
}

/** « q4 govs(5000) ×3 8001 ms, q1 published(24) 7990 ms »: the reads still waiting, oldest first. */
export function describePending(now: number = Date.now(), max = 6): string {
  const byLabel = new Map<string, { n: number; oldest: number }>();
  for (const e of open.values()) {
    const g = byLabel.get(e.label);
    if (g) {
      g.n++;
      g.oldest = Math.min(g.oldest, e.at);
    } else {
      byLabel.set(e.label, { n: 1, oldest: e.at });
    }
  }
  if (byLabel.size === 0) return "nothing pending";
  const list = [...byLabel.entries()].sort((a, b) => a[1].oldest - b[1].oldest);
  const shown = list.slice(0, max).map(([label, g]) => `${label}${g.n > 1 ? ` ×${g.n}` : ""} ${Math.max(0, now - g.oldest)} ms`);
  return shown.join(", ") + (list.length > max ? `, +${list.length - max} more` : "");
}
