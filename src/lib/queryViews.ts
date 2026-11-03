/**
 * Pages served from the CDN whose address can also carry a query that picks
 * another view of them: a page of the list, a tag, a deal, a draft.
 *
 * A static page cannot read its query — the CDN keeps one copy per path and
 * hands it out whatever follows the « ? ». So the proxy sends an address
 * carrying one of these keys to the page's twin under /<locale>/_query/…
 * (src/app/[locale]/%5Fquery), which renders on each request, reads the query
 * and draws the page with the same code. The bare address, which is what
 * nearly every visitor opens (and every shared link with only ?fbclid= or
 * ?utm_… on it), stays on the CDN.
 *
 * The twin is an internal address: the reader keeps the public one in the
 * bar, and a direct request for /<locale>/_query/… is sent back to it.
 */
export const QUERY_SEGMENT = "_query";

const VIEWS: readonly { path: RegExp; keys: readonly string[] }[] = [
  // /guides?tag=achat&page=2 (src/app/[locale]/guides/page.tsx)
  { path: /^\/[^/]+\/guides$/, keys: ["tag", "page"] },
  // /guides/<slug>?apercu: a draft, for an admin (src/app/[locale]/guides/[slug]/page.tsx)
  { path: /^\/[^/]+\/guides\/[^/]+$/, keys: ["apercu"] },
  // /agences/<slug>?deal=sale&page=2 (src/app/[locale]/agences/[slug]/page.tsx)
  { path: /^\/[^/]+\/agences\/[^/]+$/, keys: ["deal", "page"] },
  // /agences/<slug>/projets/<project>?f=available
  { path: /^\/[^/]+\/agences\/[^/]+\/projets\/[^/]+$/, keys: ["f"] },
];

/** The twin's path for this address, or null when the static page answers it. */
export function queryViewPath(pathname: string, query: URLSearchParams): string | null {
  const view = VIEWS.find((v) => v.path.test(pathname));
  if (!view || !view.keys.some((k) => query.has(k))) return null;
  const [, locale, ...rest] = pathname.split("/");
  return `/${locale}/${QUERY_SEGMENT}/${rest.join("/")}`;
}

const TWIN = new RegExp(`^/([^/]+)/${QUERY_SEGMENT}(?=/|$)(.*)$`);

/** The public address a twin's path stands for, or null when it is not one. */
export function publicPathOfTwin(pathname: string): string | null {
  const m = TWIN.exec(pathname);
  return m ? `/${m[1]}${m[2]}` : null;
}
