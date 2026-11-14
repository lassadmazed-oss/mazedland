/**
 * Crawlers that cost us and bring nobody.
 *
 * `/annonces` and every filter and page of it is drawn on each visit (a person
 * may be signed in, so it cannot be shared from the CDN): a visit is a render,
 * a database read and a response out of Vercel. On 2026-11-13 from 20:00 one
 * crawler alone asked for it about 700 times an hour from six addresses, and
 * the day's bill (functions, CPU, bytes out of the origin) tripled. These are
 * AI-training crawlers and the SEO tools' backlink and keyword crawlers: they
 * index nothing that sends a visitor. The search engines (Google, Bing, Apple),
 * Meta's link previews and the answer engines that send people are not here.
 *
 * Asked politely in /robots.txt, and refused at once by the proxy (a 403 is a
 * few milliseconds; the page is a render) for the ones that do not read it.
 *
 * Matched on the name each crawler gives itself in its User-Agent.
 */
export const BLOCKED_CRAWLERS = [
  "GPTBot", // OpenAI's training crawler (ChatGPT's search crawler is OAI-SearchBot, not blocked)
  "CCBot", // Common Crawl, the corpus most models are trained on
  "Bytespider", // ByteDance
  "ElevenlabsCrawler",
  "SERankingBacklinksBot",
  "SemrushBot",
  "AhrefsBot",
  "MJ12bot", // Majestic
  "DotBot", // Moz
  "DataForSeoBot",
  "PetalBot", // Huawei
  "Barkrowler",
] as const;

/** True when this User-Agent is one of the crawlers above. */
export function isBlockedCrawler(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return BLOCKED_CRAWLERS.some((name) => ua.includes(name.toLowerCase()));
}
