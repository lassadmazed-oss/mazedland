/**
 * How much of the page-view log a navigation keeps.
 *
 * The log is the biggest thing in the database (about 24 000 rows a day on
 * 2026-11-25, half of the 389 MB). 41 % of the week's page views were the team
 * itself moving about the console (/admin): the same moderation queue and
 * Prospection pages opened again and again. A view of the console says nothing
 * a statistic of one tenth does not, and what the team DOES is kept in full
 * (the « action » rows of the log, and admin_audit): only the reading is kept
 * at one in ten, like an anonymous visitor's.
 *
 * Every other signed-in view is still kept whole (the « who is active, and
 * where » signal), and an anonymous one at 10 %. The three rates are
 * environment variables, so an operator can change them without a deploy.
 */
export type PageViewRates = { signedIn: number; anonymous: number; console: number };

/** A path of the console, in any of the site's languages. */
export function isConsolePath(path: string): boolean {
  return /^\/+(fr|ar|en)\/+admin(?:\/.*)?$/i.test(path);
}

/** The share of this navigation's page views that is kept: 1 is all of them, 0.1 one in ten. */
export function pageViewRate(path: string, signedIn: boolean, rates: PageViewRates): number {
  if (!signedIn) return rates.anonymous;
  return isConsolePath(path) ? rates.console : rates.signedIn;
}
