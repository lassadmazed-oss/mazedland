/**
 * The site's settings, read once per request (React `cache`) from
 * `app_settings`, with each registry default filling what is missing.
 *
 * One query for every setting rather than one per module: a page that asks
 * for the visit rules, the compare limit and the WhatsApp number costs a
 * single round trip.
 *
 * Kept between requests too (2026-11-25, the speed plan): every dynamic page
 * and route paid that query, a 232-key list, before anything else. The copy
 * lives at most a minute, and saving in the console (the only writer,
 * /api/admin/settings) drops it at once (`SETTINGS_TAG`), so a value changed
 * there still applies to the next request. A value written straight into the
 * database (a script) shows within the minute. A failed read is never kept:
 * that request reads again on its own.
 */
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { readSetting } from "./define";
import { SETTINGS, type SettingKey, type Settings, type ClientSettings } from "./registry";

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

/** Every setting, from a row set as `app_settings` returns it. */
export function settingsFromRows(rows: readonly { key: string; value: unknown }[]): Settings {
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out = {} as Record<SettingKey, unknown>;
  for (const key of Object.keys(SETTINGS) as SettingKey[]) {
    out[key] = byKey.has(key) ? readSetting(SETTINGS[key], byKey.get(key)) : readSetting(SETTINGS[key], undefined);
  }
  return out as Settings;
}

/** With a client already in hand (routes, crons, libraries). */
export async function loadSettings(admin: Admin | null): Promise<Settings> {
  if (!admin) return settingsFromRows([]);
  const { data } = await admin
    .from("app_settings")
    .select("key, value")
    .in("key", Object.keys(SETTINGS));
  return settingsFromRows((data ?? []) as { key: string; value: unknown }[]);
}

/** The cache tag the console's save clears. */
export const SETTINGS_TAG = "app-settings";

const sharedRows = unstable_cache(
  async (): Promise<{ key: string; value: unknown }[]> => {
    const admin = getServiceSupabase();
    if (!admin) throw new Error("settings: no database client");
    const { data, error } = await admin.from("app_settings").select("key, value").in("key", Object.keys(SETTINGS));
    // Thrown, not returned: a failed read must not be kept for a minute.
    if (error) throw new Error(`settings: ${error.message}`);
    return (data ?? []) as { key: string; value: unknown }[];
  },
  ["app-settings-v1"],
  { revalidate: 60, tags: [SETTINGS_TAG] },
);

/** In a server component or a route: once per request, however many ask, from the shared copy. */
export const getSettings = cache(async (): Promise<Settings> => {
  try {
    return settingsFromRows(await sharedRows());
  } catch {
    // No shared cache here (a script, a test) or the read failed: this request reads on its own.
    return loadSettings(getServiceSupabase());
  }
});

/** What client components may read: the `client` settings, never a secret. */
export function clientSettings(all: Settings): ClientSettings {
  const out = {} as Record<string, unknown>;
  for (const key of Object.keys(SETTINGS) as SettingKey[]) {
    const def = SETTINGS[key] as { client?: boolean; secret?: boolean };
    if (def.client && !def.secret) out[key] = all[key];
  }
  return out as ClientSettings;
}
