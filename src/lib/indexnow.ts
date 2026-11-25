/**
 * IndexNow — telling Bing (and Yandex, Seznam, Naver…) the moment an annonce
 * appears, changes or goes, instead of waiting for their crawler. ChatGPT search
 * and Copilot lean on Bing's index, so this is also the fastest way into AI
 * answers (2026-11-25).
 *
 * The protocol: the site publishes its key at /indexnow.txt (src/app/indexnow.txt),
 * then POSTs { host, key, keyLocation, urlList } to api.indexnow.org, which
 * shares it with every engine that takes part. An hourly job
 * (src/app/api/cron/indexnow) sends the annonces touched in the last hour, in
 * both languages. Pure helpers here; the network call is the one function that
 * fetches.
 */
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
/** The protocol takes up to 10 000 addresses a request. */
export const INDEXNOW_MAX_URLS = 10_000;

export type IndexNowBody = { host: string; key: string; keyLocation: string; urlList: string[] };

export function indexNowBody(origin: string, key: string, urls: readonly string[]): IndexNowBody {
  const base = origin.replace(/\/+$/, "");
  return {
    host: new URL(base).host,
    key,
    keyLocation: `${base}/indexnow.txt`,
    urlList: Array.from(new Set(urls)).slice(0, INDEXNOW_MAX_URLS),
  };
}

/** An annonce's address in every language of the site. */
export function annonceUrls(origin: string, ids: readonly string[], locales: readonly string[]): string[] {
  const base = origin.replace(/\/+$/, "");
  return ids.flatMap((id) => locales.map((l) => `${base}/${l}/annonces/${id}`));
}

/** POSTs the addresses; the HTTP status (200/202 = taken), or null when nothing was sent or the call failed. */
export async function submitIndexNow(origin: string, key: string, urls: readonly string[]): Promise<number | null> {
  if (!key || urls.length === 0) return null;
  try {
    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(indexNowBody(origin, key, urls)),
    });
    return res.status;
  } catch {
    return null;
  }
}
