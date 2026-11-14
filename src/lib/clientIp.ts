import type { NextRequest } from "next/server";

/**
 * An IPv6 address as the unit a limit counts: its /64.
 *
 * A home or mobile line is given a whole /64 (2^64 addresses); counting each
 * address on its own lets one subscriber rotate through a fresh « IP » for every
 * request and walk around every per-IP limit. IPv4 and anything that is not an
 * IPv6 literal are returned as they are.
 */
export function ipKey(ip: string): string {
  if (!ip.includes(":") || ip.includes(".")) return ip; // IPv4, or an IPv4-mapped IPv6
  const zone = ip.indexOf("%");
  const bare = zone >= 0 ? ip.slice(0, zone) : ip;
  const [head, tail, ...rest] = bare.split("::");
  if (rest.length > 0) return ip;
  const left = head ? head.split(":") : [];
  const right = tail !== undefined && tail ? tail.split(":") : [];
  if (tail === undefined && left.length !== 8) return ip;
  const fill = 8 - left.length - right.length;
  if (tail !== undefined && fill < 1) return ip;
  const groups = tail === undefined ? left : [...left, ...Array<string>(fill).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return ip;
  return `${groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/**
 * Best-effort REAL client IP (audit #6/#9) — what to LOG.
 *
 * The leftmost `x-forwarded-for` entry is ATTACKER-CONTROLLED: a client can send
 * its own `X-Forwarded-For` header and the platform appends the real connecting
 * IP to the RIGHT. So keying a rate limit on `xff.split(",")[0]` lets an attacker
 * rotate a fake leftmost value per request and bypass the cap entirely.
 *
 * Prefer the headers the platform sets itself and a client cannot forge:
 *   1. `x-vercel-forwarded-for` — Vercel-set, leftmost is the real client IP.
 *   2. `x-real-ip`             — Vercel-set to the real client IP.
 *   3. `x-forwarded-for` LAST hop — the entry added by the trusted edge proxy,
 *      not the client-controlled first one.
 * Falls back to "anonymous" (local/dev) so the limiter still has a stable key.
 */
export function trustedIp(req: Pick<NextRequest, "headers">): string {
  const h = req.headers;
  const vercel = h.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0]!.trim();
  const real = h.get("x-real-ip");
  if (real) return real.trim();
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1]!; // trusted last hop
  }
  return "anonymous";
}

/**
 * The client as a RATE LIMIT counts it: an IPv6 client is its /64 (`ipKey`), the
 * unit one subscriber controls.
 */
export function clientIp(req: Pick<NextRequest, "headers">): string {
  return ipKey(trustedIp(req));
}
