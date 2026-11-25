import { timeoutSignal } from "@/lib/timeoutSignal";

/**
 * Whether an annonce row exists — for the proxy, which answers a search
 * engine's crawler with a real 404 for a missing annonce (src/proxy.ts). One
 * small REST call with the service key; null when it could not be asked, which
 * the proxy reads as « let the page answer », never as a 404.
 */
export async function annonceExists(id: string): Promise<boolean | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetch(`${url}/rest/v1/listings?id=eq.${encodeURIComponent(id)}&select=id`, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
      signal: timeoutSignal(1500),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return ((await res.json()) as unknown[]).length > 0;
  } catch {
    return null;
  }
}
