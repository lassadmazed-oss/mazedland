/**
 * The texts a page sends to the browser.
 *
 * Every public page carried the whole message file but the console's: 175 KB
 * in French, 227 KB in Arabic, written into the HTML of each first visit.
 * Since 2026-11-25 (the speed plan, phase 2) the root layout sends only what
 * the browser can ask for on any page; the server keeps reading everything
 * (getTranslations), so server-rendered texts are not affected.
 *
 *   CONSOLE_ONLY   admin*, the settings' labels: the console's layout gives
 *                  its pages the whole set again.
 *   SERVER_ONLY    read only by server code (API answers, e-mails, SMS, the
 *                  footer, server-rendered sections): never asked in the browser.
 *   ROUTE_TEXTS    read in the browser only on their own pages (« Espace Pro »,
 *                  the publishing wizard, « Mon compte »…): that route's layout
 *                  adds them (src/components/i18n/RouteTexts.tsx).
 *
 * publicMessages.test.ts scans the code and fails when a browser component
 * asks for a namespace its pages do not receive.
 */
import type { AbstractIntlMessages } from "next-intl";

/** Namespaces only the console reads: admin*, and the settings' labels. */
export const CONSOLE_ONLY = /^(admin([A-Z]\w*)?|settingsRegistry)$/;

/** Read only on the server (no browser component asks for them). */
export const SERVER_ONLY: readonly string[] = [
  "footer",
  "accountPage",
  "accountApi",
  "paymentApi",
  "homeMap",
  "demandesBoard",
  "listingApi",
  "attributes",
  "publishApi",
  "contact",
  "notificationMail",
  "sms",
  "moderation",
  "requestsApi",
  "aiApi",
  "socialApi",
  "proApi",
  "shops",
  "visitsApi",
  "priceQuestionsApi",
  "promoApi",
  "invoice",
  "guides",
  "market",
  "offersApi",
];

/**
 * Read in the browser only under one part of the site. The key is the route
 * (its folder under src/app/[locale]); its layout adds these namespaces.
 */
export const ROUTE_TEXTS = {
  pro: ["pro", "checkout"],
  account: ["account", "promote", "requests"],
  publish: ["publish"],
  demande: ["requests"],
  payment: ["checkout"],
} as const satisfies Record<string, readonly string[]>;

export type RouteTextsKey = keyof typeof ROUTE_TEXTS;

const ROUTE_ONLY = new Set<string>(Object.values(ROUTE_TEXTS).flat());

/** Everything but the console's (what the public pages carried until 2026-11-25). */
export function publicMessages(all: AbstractIntlMessages): AbstractIntlMessages {
  return Object.fromEntries(Object.entries(all).filter(([k]) => !CONSOLE_ONLY.test(k)));
}

/** What every public page sends to the browser, plus a route's own namespaces when given. */
export function clientMessages(all: AbstractIntlMessages, route?: RouteTextsKey): AbstractIntlMessages {
  const extra = new Set<string>(route ? ROUTE_TEXTS[route] : []);
  return Object.fromEntries(
    Object.entries(all).filter(
      ([k]) => !CONSOLE_ONLY.test(k) && !SERVER_ONLY.includes(k) && (!ROUTE_ONLY.has(k) || extra.has(k)),
    ),
  );
}
