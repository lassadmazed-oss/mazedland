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
 * 2026-11-25: from the page-view log (anonymous views are kept at 10 %), about
 * 85 % of the anonymous visits were robots — people were about 12 000 a day —
 * and Meta's AI crawler (`meta-externalagent`) alone was about 43 000 a day,
 * nearly all on /annonces. Meta says it is its AI-training / indexing crawler;
 * the link previews of our Facebook posts are `facebookexternalhit`, which is
 * not here, and neither is `meta-externalfetcher` (a person asking Meta AI
 * about a link).
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
  "Reflectionbot", // Reflection AI's crawler
] as const;

/**
 * Crawlers let in through a small door (the owner, 2026-11-25): Meta's AI
 * crawler may read the pages that matter — an annonce, an agence, a guide, the
 * home — but never an address with a query string (the catalogue's filter
 * combinations were 90 % of its 43 000 visits a day), and only so many pages a
 * day (`crawler_meta_daily_budget`, 3 000 by default: enough to read every
 * annonce daily; 0 closes the door). Meta AI may then quote our annonces when
 * someone asks it in WhatsApp or Messenger. Its link previews
 * (facebookexternalhit) are not concerned.
 */
export const LIMITED_CRAWLERS = [{ name: "meta-externalagent", budget: "crawler_meta_daily_budget" }] as const;
export type LimitedCrawler = (typeof LIMITED_CRAWLERS)[number];

/** The limited crawler this User-Agent is, or null. */
export function limitedCrawler(userAgent: string | null | undefined): LimitedCrawler | null {
  if (!userAgent) return null;
  const ua = userAgent.toLowerCase();
  return LIMITED_CRAWLERS.find((c) => ua.includes(c.name.toLowerCase())) ?? null;
}

/**
 * What the door answers: `allow`, `query` (an address with a query string: 403),
 * `closed` (budget 0: 403) or `over` (today's pages read: 429). `over` is the
 * budget counter's answer, asked only when the rest let the request through.
 */
export function doorVerdict(input: { hasQuery: boolean; budget: number; over: boolean | null }): "allow" | "query" | "closed" | "over" {
  if (input.budget <= 0) return "closed";
  if (input.hasQuery) return "query";
  return input.over ? "over" : "allow";
}

/** True when this User-Agent is one of the crawlers above. */
export function isBlockedCrawler(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return BLOCKED_CRAWLERS.some((name) => ua.includes(name.toLowerCase()));
}
