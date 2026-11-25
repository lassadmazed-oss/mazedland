/**
 * The page a `?page=` parameter asks for: a whole number from 1. Anything
 * else — absent, « abc », 0, a negative — is the first page, so a hand-typed
 * or stale address never asks the database for a range it cannot serve.
 *
 * Shared by the catalogue and the agence pages so both read the same address
 * the same way.
 */
export function pageNumber(raw: string | undefined): number {
  return Math.max(1, Math.floor(Number(raw)) || 1);
}

/**
 * The page numbers the pager shows: the first, the last, and two on each side
 * of the current one; null where pages are skipped (« … »).
 */
export function pageNumbers(page: number, last: number): (number | null)[] {
  const keep = new Set([1, last, page - 2, page - 1, page, page + 1, page + 2].filter((n) => n >= 1 && n <= last));
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  for (const n of sorted) {
    const prev = out[out.length - 1];
    if (typeof prev === "number" && n - prev > 1) out.push(n - prev === 2 ? prev + 1 : null);
    out.push(n);
  }
  return out;
}
