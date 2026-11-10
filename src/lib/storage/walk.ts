import type { getServiceSupabase } from "@/lib/supabase/admin";
import type { StoredObject } from "./prune";

/**
 * Reading every row of a table and every object of a bucket, for the nightly
 * jobs that compare the two (/api/cron/prune-uploads, /api/cron/photo-sizes).
 */

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

/** PostgREST answers at most this many rows per request. */
const PAGE = 1000;

/**
 * Every row of a query, page by page. A plain select stops at PostgREST's
 * row limit, and a reference list cut short is a referenced file deleted —
 * so an error anywhere aborts the whole run rather than shortens the list.
 */
export async function everyRow<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** Every object of a bucket, folder by folder (Storage lists one level at a time). */
export async function walk(admin: Admin, bucket: string, prefix = ""): Promise<StoredObject[]> {
  const out: StoredObject[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: PAGE, offset });
    if (error) throw error;
    for (const e of data ?? []) {
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      // A folder is listed with no object id.
      if (e.id === null) out.push(...(await walk(admin, bucket, path)));
      else out.push({ path, createdAt: e.created_at ?? e.updated_at ?? null });
    }
    if (!data || data.length < PAGE) break;
  }
  return out;
}
